import {
  SQSClient,
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSServiceException,
} from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';

// Set required environment variables before importing handler
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../lambdas/message';

const sqsMock = mockClient(SQSClient);

describe('Message Lambda', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AWS_REGION = 'us-east-1';
    sqsMock.reset();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createEvent = (
    method = 'POST',
    path = '/message',
    body?: string,
  ): APIGatewayProxyEventV2 => ({
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'id.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'id',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: 'IP',
        userAgent: 'agent',
      },
      requestId: 'id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '12/Mar/2020:19:03:58 +0000',
      timeEpoch: 1583348638390,
    },
    body,
    isBase64Encoded: false,
  });

  it('should return 405 for non-POST requests', async () => {
    const event = createEvent('GET', '/message');
    const response = await handler(event);
    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'Method not allowed',
    });
  });

  it('should return 405 for incorrect paths', async () => {
    const event = createEvent('POST', '/wrong-path');
    const response = await handler(event);
    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'Method not allowed',
    });
  });

  it('should return 400 for missing body', async () => {
    const event = createEvent('POST', '/message');
    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'Missing request body',
    });
  });

  it('should return 400 for invalid request format', async () => {
    const event = createEvent('POST', '/message', JSON.stringify({ invalid: 'format' }));
    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'Invalid request format',
    });
  });

  it('should return 404 when queue does not exist', async () => {
    sqsMock.on(GetQueueUrlCommand).rejects(
      new SQSServiceException({
        name: 'QueueDoesNotExist',
        $fault: 'client',
        $metadata: {},
        message: 'Queue does not exist',
      }),
    );

    const event = createEvent(
      'POST',
      '/message',
      JSON.stringify({
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
        message: 'test message',
      }),
    );

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'Session not found',
    });
  });

  it('should successfully send message to queue', async () => {
    sqsMock
      .on(GetQueueUrlCommand)
      .resolves({ QueueUrl: 'test-queue-url' })
      .on(SendMessageCommand)
      .resolves({});

    const event = createEvent(
      'POST',
      '/message',
      JSON.stringify({
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
        message: 'test message',
      }),
    );

    const response = await handler(event);
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body as string)).toEqual({
      status: 'Message accepted',
    });
    expect(sqsMock.calls()).toHaveLength(2);
  });

  it('should handle unexpected errors', async () => {
    sqsMock.on(GetQueueUrlCommand).rejects(new Error('Unexpected error'));

    const event = createEvent(
      'POST',
      '/message',
      JSON.stringify({
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
        message: 'test message',
      }),
    );

    const response = await handler(event);
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'Internal server error',
    });
  });
});
