import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListResourcesResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ResponseStream, streamifyResponse } from 'lambda-stream';
import { z } from 'zod';

import { ResponseBodySchema, decodeLambdaResponse } from '../../types/lambda';
import { ResourceParameters, fromDynamoFormat } from '../../types/registration';

import { LambdaSSETransport } from './lambda-sse-transport';

const { AWS_REGION, REGISTRATION_TABLE_NAME } = process.env;

if (!AWS_REGION || !REGISTRATION_TABLE_NAME) {
  throw new Error('Required environment variables are not set');
}

const sqsClient = new SQSClient({ region: AWS_REGION });
const dynamodbClient = new DynamoDBClient({ region: AWS_REGION });
const lambdaClient = new LambdaClient({ region: AWS_REGION });

async function invokeLambda<T>(
  lambdaArn: string,
  payload: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const { Payload } = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: lambdaArn,
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );

  if (!Payload) {
    throw new Error('No response from Lambda');
  }

  return decodeLambdaResponse(Payload, schema);
}

export const handler = streamifyResponse(
  async (event: APIGatewayProxyEventV2, responseStream: ResponseStream): Promise<void> => {
    const {
      requestContext: {
        http: { method, path },
      },
    } = event;

    if (method !== 'GET' || !path.endsWith('/sse')) {
      throw new Error('Invalid request method or path');
    }

    const messageEndpoint = `${process.env.MESSAGE_FUNCTION_URL}/message`;
    const server = new McpServer({
      name: 'MCP Lambda Server',
      version: '1.0.7',
    });

    const { Items = [] } = await dynamodbClient.send(
      new ScanCommand({
        TableName: REGISTRATION_TABLE_NAME,
      }),
    );

    for (const item of Items) {
      const registration = fromDynamoFormat(item);

      switch (registration.type) {
        case 'tool':
          server.tool(
            registration.name,
            registration.description,
            registration.parameters,
            async (args, extra) => {
              return invokeLambda(registration.lambdaArn, { args, extra }, ResponseBodySchema.tool);
            },
          );
          break;

        case 'resource': {
          const { uriTemplate, completions } = ResourceParameters.parse(registration.parameters);

          server.resource(
            registration.name,
            new ResourceTemplate(uriTemplate, {
              list: async (extra): Promise<ListResourcesResult> =>
                invokeLambda(
                  registration.lambdaArn,
                  { action: 'list', extra },
                  ResponseBodySchema.listResource,
                ),
              complete: completions,
            }),
            { description: registration.description },
            async (uri, variables, extra): Promise<ReadResourceResult> => {
              return invokeLambda(
                registration.lambdaArn,
                { action: 'read', uri: uri.toString(), variables, extra },
                ResponseBodySchema.readResource,
              );
            },
          );
          break;
        }

        case 'prompt':
          server.prompt(
            registration.name,
            registration.description,
            registration.parameters,
            async (args, extra) => {
              return invokeLambda(
                registration.lambdaArn,
                { args, extra },
                ResponseBodySchema.prompt,
              );
            },
          );
          break;
      }
    }

    const transport = new LambdaSSETransport(messageEndpoint, responseStream);
    const { sessionId } = transport;
    const queueName = `mcp-session-${sessionId}.fifo`;

    try {
      const { QueueUrl } = await sqsClient.send(
        new CreateQueueCommand({
          QueueName: queueName,
          Attributes: {
            FifoQueue: 'true',
            ContentBasedDeduplication: 'true',
          },
        }),
      );

      if (!QueueUrl) {
        throw new Error('Failed to create SQS queue');
      }

      await server.connect(transport);

      void (async (): Promise<void> => {
        const receiveParams = {
          QueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
        };

        while (!responseStream.destroyed) {
          try {
            const { Messages = [] } = await sqsClient.send(
              new ReceiveMessageCommand(receiveParams),
            );

            if (responseStream.destroyed) break;

            for (const { Body, ReceiptHandle } of Messages) {
              if (Body) {
                transport.handleMessage(Body);
              }
              if (ReceiptHandle) {
                await sqsClient.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle }));
              }
            }

            if (Messages.length === 0) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (error) {
            if (!responseStream.destroyed) {
              console.error('Error receiving messages:', error);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
      })();

      await new Promise<void>(resolve => {
        responseStream.on('close', () => {
          void (async (): Promise<void> => {
            try {
              await sqsClient.send(new DeleteQueueCommand({ QueueUrl }));
            } catch (error) {
              console.error('Error deleting queue:', error);
            }
            resolve();
          })();
        });
      });
    } catch (error) {
      console.error('Error in SSE setup:', error);
      throw error;
    }
  },
);
