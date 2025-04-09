import {
  SQSClient,
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSServiceException,
} from '@aws-sdk/client-sqs';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ResponseStream } from 'lambda-stream';

export function getMessageHandler() {
  const { AWS_REGION } = process.env;
  if (!AWS_REGION) {
    throw new Error('AWS_REGION environment variable is required');
  }

  const sqsClient = new SQSClient({ region: AWS_REGION });

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

    const queueName = `mcp-session-${sessionId}.fifo`;

    try {
      console.log('Finding url for SQS queue:', queueName);
      const { QueueUrl } = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }));

      console.log('Sending message to SQS queue:', QueueUrl);
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl,
          MessageBody: body,
          MessageGroupId: sessionId,
        }),
      );

      responseStream.write(JSON.stringify({ status: 'Message accepted' }));
      responseStream.end();
    } catch (error) {
      if (error instanceof SQSServiceException && error.name === 'QueueDoesNotExist') {
        console.log(error);
        responseStream.write(JSON.stringify({ error: 'Session not found' }));
        responseStream.end();
      } else {
        responseStream.write(JSON.stringify({ error: 'Internal server error' }));
        responseStream.end();
      }
    }
  };
}
