import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListResourcesResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ResponseStream } from 'lambda-stream';
import { z } from 'zod';

import { ResponseBodySchema, decodeLambdaResponse } from '../../types/lambda';
import { ResourceParameters, fromDynamoFormat } from '../../types/registration';
import { jsonToZodSchema } from '../../utils/zod-from-json';

import { LambdaSSETransport } from './lambda-sse-transport';

export function getSseHandler() {
  const { AWS_REGION, REGISTRATION_TABLE_NAME, SESSION_TABLE_NAME } = process.env;

  if (!AWS_REGION || !REGISTRATION_TABLE_NAME || !SESSION_TABLE_NAME) {
    throw new Error('Required environment variables are not set');
  }

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

  return async function handleSse(
    _event: APIGatewayProxyEventV2,
    responseStream: ResponseStream,
  ): Promise<void> {
    const messageEndpoint = '/message';
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
            jsonToZodSchema(registration.parameters).shape,
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
            jsonToZodSchema(registration.parameters).shape,
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
    const sessionId: string = transport.sessionId;
    const controller = new AbortController();

    try {
      await dynamodbClient.send(
        new PutItemCommand({
          TableName: SESSION_TABLE_NAME,
          Item: {
            sessionId: { S: sessionId },
          },
        }),
      );

      await server.connect(transport);

      responseStream.on('close', (): void => {
        console.log('Connection closed, cleaning up resources', sessionId);
        controller.abort();
        void dynamodbClient.send(
          new DeleteItemCommand({
            TableName: SESSION_TABLE_NAME,
            Key: {
              sessionId: { S: sessionId },
            },
          }),
        );
      });

      while (!controller.signal.aborted) {
        if (controller.signal.aborted) {
          break;
        }

        const { Item } = await dynamodbClient.send(
          new GetItemCommand({
            TableName: SESSION_TABLE_NAME,
            Key: {
              sessionId: { S: sessionId },
            },
          }),
        );

        const queue = Item?.messageQueue?.L ?? [];

        if (queue.length > 0) {
          await dynamodbClient.send(
            new UpdateItemCommand({
              TableName: SESSION_TABLE_NAME,
              Key: {
                sessionId: { S: sessionId },
              },
              UpdateExpression: 'REMOVE messageQueue',
            }),
          );
        }

        for (const entry of queue) {
          const message = entry.M;
          const payload = message?.payload?.S;
          if (typeof payload === 'string') {
            transport.handleMessage(payload);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Error in SSE setup:', error);
      throw error;
    }
  };
}
