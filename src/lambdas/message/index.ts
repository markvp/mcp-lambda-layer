import {
  SQSClient,
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSServiceException,
} from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';

import { APIGatewayResult } from '../../types/lambda';

const { AWS_REGION } = process.env;

if (!AWS_REGION) {
  throw new Error('AWS_REGION environment variable is required');
}

const sqsClient = new SQSClient({ region: AWS_REGION });

const MessageRequestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string(),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayResult> {
  const {
    requestContext: {
      http: { method, path },
    },
    body,
  } = event;

  if (method !== 'POST' || !path.endsWith('/message')) {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  if (!body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  let parsedRequest;

  try {
    parsedRequest = MessageRequestSchema.parse(JSON.parse(body));
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid request format' }),
    };
  }

  const { sessionId, message } = parsedRequest;
  const queueName = `mcp-session-${sessionId}.fifo`;

  try {
    const { QueueUrl } = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }));

    // Send message to queue
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl,
        MessageBody: message,
        MessageGroupId: sessionId,
      }),
    );

    return {
      statusCode: 202,
      body: JSON.stringify({ status: 'Message accepted' }),
    };
  } catch (error) {
    if (error instanceof SQSServiceException && error.name === 'QueueDoesNotExist') {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
