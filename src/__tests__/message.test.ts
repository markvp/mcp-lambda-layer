import { EventEmitter } from 'events';

import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { ResponseStream } from 'lambda-stream';

import { getMessageHandler } from '../lambdas/mcp/message';

const dynamoMock = mockClient(DynamoDBClient);
let handleMessage: ReturnType<typeof getMessageHandler>;

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
    process.env.SESSION_TABLE_NAME = 'test-session-table';
    dynamoMock.reset();

    handleMessage = getMessageHandler();

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

  it('should return 404 when session is not found', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

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
      JSON.stringify({ error: 'Session invalid' }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
  });

  it('should successfully enqueue a message', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: { sessionId: { S: '123e4567-e89b-12d3-a456-426614174000' } },
    });
    dynamoMock.on(UpdateItemCommand).resolves({});

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
      JSON.stringify({ status: 'Message accepted' }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
  });

  it('should handle unexpected errors', async () => {
    dynamoMock.on(GetItemCommand).rejects(new Error('Unexpected error'));

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
      JSON.stringify({ error: 'Internal server error' }),
    );
    expect(mockResponseStream.end).toHaveBeenCalled();
  });
});
