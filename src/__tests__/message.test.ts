import { EventEmitter } from 'events';

import {
  SQSClient,
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSServiceException,
} from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { ResponseStream } from 'lambda-stream';

// Set required environment variables before importing handler
process.env.AWS_REGION = 'us-east-1';

import { getMessageHandler } from '../lambdas/mcp/message';

const sqsMock = mockClient(SQSClient);
const handleMessage = getMessageHandler();

describe('Message Lambda', () => {
  let mockResponseStream: ResponseStream & {
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    destroyed: boolean;
  };

  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AWS_REGION = 'us-east-1';
    sqsMock.reset();

    mockResponseStream = new ResponseStream() as ResponseStream & {
      write: jest.Mock;
      end: jest.Mock;
      on: jest.Mock;
      destroyed: boolean;
    };
    mockResponseStream.write = jest.fn();
    mockResponseStream.end = jest.fn();
    mockResponseStream.destroyed = false;

    Object.setPrototypeOf(mockResponseStream, EventEmitter.prototype);
    EventEmitter.call(mockResponseStream);

    jest.spyOn(mockResponseStream, 'on');
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createEvent = (
    method = 'POST',
    path = '/message',
    body?: string,
    queryStringParameters: Record<string, string> = {},
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
    queryStringParameters,
  });

  it('should return 400 for missing body', async () => {
    const event = createEvent('POST', '/message', undefined, {
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    });
    await handleMessage(event, mockResponseStream);
    expect(mockResponseStream.write).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'Missing request body, expected a raw JSON-RPC message string',
      }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
  });

  it('should return 400 for missing sessionId', async () => {
    const event = createEvent(
      'POST',
      '/message',
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'testMethod',
        params: {},
        id: 1,
      }),
    );
    await handleMessage(event, mockResponseStream);
    expect(mockResponseStream.write).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'Missing sessionId query parameter',
      }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
  });

  it('should return 400 for invalid request format', async () => {
    const event = createEvent('POST', '/message', 'invalid json', {
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    });
    await handleMessage(event, mockResponseStream);
    expect(mockResponseStream.write).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'Invalid JSON-RPC format',
      }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
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
        jsonrpc: '2.0',
        method: 'testMethod',
        params: {},
        id: 1,
      }),
      { sessionId: '123e4567-e89b-12d3-a456-426614174000' },
    );

    await handleMessage(event, mockResponseStream);
    expect(mockResponseStream.write).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'Session not found',
      }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
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
        jsonrpc: '2.0',
        method: 'testMethod',
        params: {},
        id: 1,
      }),
      { sessionId: '123e4567-e89b-12d3-a456-426614174000' },
    );

    await handleMessage(event, mockResponseStream);
    expect(mockResponseStream.write).toHaveBeenCalledWith(
      JSON.stringify({
        status: 'Message accepted',
      }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
    expect(sqsMock.calls()).toHaveLength(2);
  });

  it('should handle unexpected errors', async () => {
    sqsMock.on(GetQueueUrlCommand).rejects(new Error('Unexpected error'));

    const event = createEvent(
      'POST',
      '/message',
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'testMethod',
        params: {},
        id: 1,
      }),
      { sessionId: '123e4567-e89b-12d3-a456-426614174000' },
    );

    await handleMessage(event, mockResponseStream);
    expect(mockResponseStream.write).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'Internal server error',
      }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
  });
});
