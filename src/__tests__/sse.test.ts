import { EventEmitter } from 'events';

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { ResponseStream } from 'lambda-stream';

// Set required environment variables before importing handler
process.env.AWS_REGION = 'us-east-1';
process.env.REGISTRATION_TABLE_NAME = 'test-table';

import { LambdaSSETransport } from '../lambdas/mcp/lambda-sse-transport';
import { getSseHandler } from '../lambdas/mcp/sse';

let handleSse: ReturnType<typeof getSseHandler>;

const dynamoMock = mockClient(DynamoDBClient);
const sqsMock = mockClient(SQSClient);

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
    process.env = { ...OLD_ENV };
    process.env.AWS_REGION = 'us-east-1';
    process.env.REGISTRATION_TABLE_NAME = 'test-table';
    process.env.MCP_EXECUTION_ROLE_ARN = 'arn:aws:iam::123456789012:role/mcp-test-role';
    process.env.MESSAGE_FUNCTION_URL = 'https://test-message-url';
    dynamoMock.reset();
    sqsMock.reset();
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

    // Mock successful SQS queue creation
    sqsMock
      .on(CreateQueueCommand)
      .resolves({ QueueUrl: 'test-queue-url' })
      .on(GetQueueAttributesCommand)
      .resolves({ Attributes: { QueueArn: 'test-queue-arn' } })
      .on(ReceiveMessageCommand)
      .resolves({ Messages: [] })
      .on(DeleteQueueCommand)
      .resolves({});

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
      { input: 'string' },
      expect.any(Function),
    );

    expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
  });

  it('should handle registration loading errors', async () => {
    const event = createEvent();
    dynamoMock.on(ScanCommand).rejects(new Error('DynamoDB error'));

    await expect(handleSse(event, mockResponseStream)).rejects.toThrow('DynamoDB error');
  });

  it('should handle queue creation errors', async () => {
    const event = createEvent();
    dynamoMock.on(ScanCommand).resolves({ Items: [] });
    sqsMock.on(CreateQueueCommand).rejects(new Error('SQS error'));

    await expect(handleSse(event, mockResponseStream)).rejects.toThrow('SQS error');
  });

  it('should clean up resources on connection close', async () => {
    const event = createEvent();

    // Mock successful initialization
    dynamoMock.on(ScanCommand).resolves({ Items: [] });
    sqsMock
      .on(CreateQueueCommand)
      .resolves({ QueueUrl: 'test-queue-url' })
      .on(GetQueueAttributesCommand)
      .resolves({ Attributes: { QueueArn: 'test-queue-arn' } })
      .on(ReceiveMessageCommand)
      .resolves({ Messages: [] })
      .on(DeleteQueueCommand)
      .resolves({});

    // Create basic transport mock
    const mockTransport = {
      sessionId: 'test-session',
      start: jest.fn().mockResolvedValueOnce(undefined),
      handleMessage: jest.fn(),
    };
    (LambdaSSETransport as jest.Mock).mockImplementation(() => mockTransport);

    // Mock MCP server
    const mockServer = {
      connect: jest.fn().mockResolvedValueOnce(undefined),
    };
    (McpServer as jest.Mock).mockImplementation(() => mockServer);

    const ssePromise = handleSse(event, mockResponseStream);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
    const onCalls = (mockResponseStream.on as jest.Mock).mock.calls as [string, () => void][];
    const closeCallback = onCalls.find(([event]) => event === 'close')?.[1];
    expect(typeof closeCallback).toBe('function');

    const wrappedCloseSpy = jest.fn(closeCallback);
    mockResponseStream.off('close', closeCallback!);
    mockResponseStream.on('close', wrappedCloseSpy);

    mockResponseStream.emit('close');

    await ssePromise;

    expect(abortSpy).toHaveBeenCalled();
    expect(wrappedCloseSpy).toHaveBeenCalled();

    // Verify queue deletion
    expect(sqsMock.commandCalls(DeleteQueueCommand)).toHaveLength(1);
    expect(sqsMock.commandCalls(DeleteQueueCommand)[0].args[0].input).toEqual({
      QueueUrl: 'test-queue-url',
    });
  });
});
