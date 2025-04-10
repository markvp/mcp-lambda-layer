import { EventEmitter } from 'events';

import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { ResponseStream } from 'lambda-stream';
import { z } from 'zod';

// Set required environment variables before importing handler
process.env.AWS_REGION = 'us-east-1';
process.env.REGISTRATION_TABLE_NAME = 'test-table';

import { LambdaSSETransport } from '../lambdas/mcp/lambda-sse-transport';
import { getSseHandler } from '../lambdas/mcp/sse';

let handleSse: ReturnType<typeof getSseHandler>;

const dynamoMock = mockClient(DynamoDBClient);

jest.mock('@modelcontextprotocol/sdk/server/mcp');
jest.mock('../lambdas/mcp/lambda-sse-transport');

describe('SSE Lambda', () => {
  const OLD_ENV = process.env;
  let mockResponseStream: ResponseStream & {
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    destroyed: boolean;
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, SESSION_TABLE_NAME: 'test-sessions' };
    process.env.AWS_REGION = 'us-east-1';
    process.env.REGISTRATION_TABLE_NAME = 'test-table';
    process.env.MESSAGE_FUNCTION_URL = 'https://test-message-url';
    dynamoMock.reset();
    jest.clearAllMocks();
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

    handleSse = getSseHandler();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createEvent = (method = 'GET', path = '/sse'): APIGatewayProxyEventV2 => ({
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
    isBase64Encoded: false,
  });

  const mockRegistration = {
    id: { S: 'test#tool-example' },
    type: { S: 'tool' },
    name: { S: 'example' },
    description: { S: 'An example tool' },
    lambdaArn: { S: 'arn:aws:lambda:us-east-1:123456789012:function:example' },
    parameters: { S: JSON.stringify({ input: 'string' }) },
  };

  it('should initialize SSE connection with registered tools', async () => {
    const event = createEvent();

    // Mock successful DynamoDB query
    dynamoMock.on(ScanCommand).resolves({ Items: [mockRegistration] });
    dynamoMock.on(GetItemCommand).resolvesOnce({
      Item: {
        sessionId: { S: 'test-session' },
      },
    });

    // Create a mock for the transport
    const mockTransport = {
      sessionId: 'test-session',
      start: jest.fn().mockResolvedValueOnce(undefined),
      handleMessage: jest.fn(),
    };
    (LambdaSSETransport as jest.Mock).mockImplementation(() => mockTransport);

    const mockServer = {
      tool: jest.fn(),
      connect: jest.fn().mockResolvedValueOnce(undefined),
    };
    (McpServer as jest.Mock).mockImplementation(() => mockServer);

    const ssePromise = handleSse(event, mockResponseStream);

    await new Promise(resolve => setTimeout(resolve, 1000));

    mockResponseStream.emit('close');
    await ssePromise;

    expect(mockServer.tool).toHaveBeenCalledWith(
      'example',
      'An example tool',
      expect.objectContaining({ input: expect.any(z.ZodString) as z.ZodType<string> }),
      expect.any(Function),
    );

    expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
  });

  it('should handle registration loading errors', async () => {
    const event = createEvent();
    dynamoMock.on(ScanCommand).rejects(new Error('DynamoDB error'));

    await expect(handleSse(event, mockResponseStream)).rejects.toThrow('DynamoDB error');
  });

  it('should clean up resources on connection close', async () => {
    const event = createEvent();

    dynamoMock.on(ScanCommand).resolves({ Items: [] });
    dynamoMock.on(PutItemCommand).resolves({});
    dynamoMock.on(GetItemCommand).resolves({ Item: { sessionId: { S: 'test-session' } } });
    dynamoMock.on(UpdateItemCommand).resolves({});
    dynamoMock.on(DeleteItemCommand).resolves({});

    const mockTransport = {
      sessionId: 'test-session',
      start: jest.fn().mockResolvedValueOnce(undefined),
      handleMessage: jest.fn(),
    };
    (LambdaSSETransport as jest.Mock).mockImplementation(() => mockTransport);

    const mockServer = {
      connect: jest.fn().mockResolvedValueOnce(undefined),
    };
    (McpServer as jest.Mock).mockImplementation(() => mockServer);

    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');

    const ssePromise = handleSse(event, mockResponseStream);
    await new Promise(resolve => setTimeout(resolve, 1000));
    mockResponseStream.emit('close');
    await ssePromise;

    expect(abortSpy).toHaveBeenCalled();
    expect(dynamoMock.commandCalls(DeleteItemCommand)).toHaveLength(1);
  });

  it('should process and clear message queue', async () => {
    const event = createEvent();

    // Mock registrations
    dynamoMock.on(ScanCommand).resolves({ Items: [] });

    // Mock session creation
    dynamoMock.on(PutItemCommand).resolves({});

    // Mock message queue with two messages
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({
        Item: {
          sessionId: { S: 'test-session' },
          messageQueue: {
            L: [{ M: { payload: { S: 'message-1' } } }, { M: { payload: { S: 'message-2' } } }],
          },
        },
      })
      .resolvesOnce({
        Item: {
          sessionId: { S: 'test-session' },
        },
      })
      .resolves({
        Item: undefined,
      });
    // Mock clearing queue
    dynamoMock.on(UpdateItemCommand).resolvesOnce({});
    dynamoMock.on(DeleteItemCommand).resolvesOnce({});

    const mockTransport = {
      sessionId: 'test-session',
      start: jest.fn().mockResolvedValue(undefined),
      handleMessage: jest.fn(),
    };
    (LambdaSSETransport as jest.Mock).mockImplementation(() => mockTransport);

    const mockServer = {
      connect: jest.fn().mockResolvedValue(undefined),
    };
    (McpServer as jest.Mock).mockImplementation(() => mockServer);

    const ssePromise = handleSse(event, mockResponseStream);

    await new Promise(resolve => setTimeout(resolve, 1100));
    mockResponseStream.emit('close');
    await new Promise(resolve => setTimeout(resolve, 100));
    await ssePromise;

    expect(mockTransport.handleMessage).toHaveBeenCalledTimes(2);
    expect(mockTransport.handleMessage).toHaveBeenNthCalledWith(1, 'message-1');
    expect(mockTransport.handleMessage).toHaveBeenNthCalledWith(2, 'message-2');
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(1);
    expect(dynamoMock.commandCalls(DeleteItemCommand)).toHaveLength(1);
  });
});
