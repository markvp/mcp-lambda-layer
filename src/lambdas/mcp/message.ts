import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  DynamoDBServiceException,
} from '@aws-sdk/client-dynamodb';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ResponseStream } from 'lambda-stream';

export function getMessageHandler() {
  const { AWS_REGION, SESSION_TABLE_NAME } = process.env;
  if (!AWS_REGION) {
    throw new Error('AWS_REGION environment variable is required');
  }
  if (!SESSION_TABLE_NAME) {
    throw new Error('SESSION_TABLE_NAME environment variable is required');
  }

  const dynamoDBClient = new DynamoDBClient({ region: AWS_REGION });

  return async function handleMessage(
    event: APIGatewayProxyEventV2,
    responseStream: ResponseStream,
  ): Promise<void> {
    const sessionId = event.queryStringParameters?.sessionId;
    if (!sessionId) {
      responseStream.write(JSON.stringify({ error: 'Missing sessionId query parameter' }));
      responseStream.end();
    }

    const { body } = event;

    if (!body) {
      responseStream.write(
        JSON.stringify({
          error: 'Missing request body, expected a raw JSON-RPC message string',
        }),
      );
      responseStream.end();
    }

    try {
      JSONRPCMessageSchema.parse(JSON.parse(body!));
    } catch {
      responseStream.write(JSON.stringify({ error: 'Invalid JSON-RPC format' }));
      responseStream.end();
    }

    try {
      console.log('sessionId', sessionId);
      const { Item } = await dynamoDBClient.send(
        new GetItemCommand({
          TableName: SESSION_TABLE_NAME,
          Key: {
            sessionId: { S: sessionId! },
          },
        }),
      );

      if (!Item) {
        responseStream.write(JSON.stringify({ error: 'Session invalid' }));
        responseStream.end();
        return;
      }

      await dynamoDBClient.send(
        new UpdateItemCommand({
          TableName: SESSION_TABLE_NAME,
          Key: {
            sessionId: { S: sessionId! },
          },
          UpdateExpression:
            'SET messageQueue = list_append(if_not_exists(messageQueue, :emptyList), :newItem)',
          ExpressionAttributeValues: {
            ':emptyList': { L: [] },
            ':newItem': {
              L: [
                {
                  M: {
                    payload: { S: body! },
                  },
                },
              ],
            },
          },
        }),
      );

      responseStream.write(JSON.stringify({ status: 'Message accepted' }));
      responseStream.end();
    } catch (error) {
      if (error instanceof DynamoDBServiceException) {
        console.log(error);
        responseStream.write(JSON.stringify({ error: 'Internal server error' }));
        responseStream.end();
      } else {
        responseStream.write(JSON.stringify({ error: 'Internal server error' }));
        responseStream.end();
      }
    }
  };
}
