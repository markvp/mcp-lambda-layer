import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { ResponseStream } from 'lambda-stream';

// Set required environment variables before importing handler
process.env.AWS_REGION = 'us-east-1';
process.env.REGISTRATION_TABLE_NAME = 'test-table';

import { handler } from '../lambdas/sse';
import { LambdaSSETransport } from '../lambdas/sse/lambda-sse-transport';

const dynamoMock = mockClient(DynamoDBClient);
const sqsMock = mockClient(SQSClient);

jest.mock('@modelcontextprotocol/sdk/server/mcp');
jest.mock('../lambdas/sse/lambda-sse-transport');

class MockResponseStream extends ResponseStream {
  public write = jest.fn();
  public end = jest.fn();
  public on = jest.fn();
  public destroyed = false;

  public constructor() {
    super();
    this.on.mockImplementation((event: string, callback: () => void) => {
      if (event === 'close') {
        callback();
      }
      return this;
    });
  }
}

describe('SSE Lambda', () => {
  const OLD_ENV = process.env;
  let mockResponseStream: MockResponseStream;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AWS_REGION = 'us-east-1';
    process.env.REGISTRATION_TABLE_NAME = 'test-table';
    process.env.MESSAGE_FUNCTION_URL = 'https://test-message-url';
    dynamoMock.reset();
    sqsMock.reset();
    jest.clearAllMocks();
    mockResponseStream = new MockResponseStream();
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

  it('should return error for non-GET requests', async () => {
    const event = createEvent('POST', '/sse');
    await expect(handler(event, mockResponseStream)).rejects.toThrow(
      'Invalid request method or path',
    );
  });

  it('should return error for incorrect path', async () => {
    const event = createEvent('GET', '/wrong-path');
    await expect(handler(event, mockResponseStream)).rejects.toThrow(
      'Invalid request method or path',
    );
  });

  it('should initialize SSE connection with registered tools', async () => {
    const event = createEvent();

    // Mock successful DynamoDB query
    dynamoMock.on(ScanCommand).resolves({ Items: [mockRegistration] });

    // Mock successful SQS queue creation
    sqsMock
      .on(CreateQueueCommand)
      .resolves({ QueueUrl: 'test-queue-url' })
      .on(GetQueueAttributesCommand)
      .resolves({ Attributes: { QueueArn: 'test-queue-arn' } });

    // Create a mock for the transport
    const mockTransport = {
      sessionId: 'test-session',
      start: jest.fn().mockResolvedValueOnce(undefined),
      handleMessage: jest.fn(),
    };
    (LambdaSSETransport as jest.Mock).mockImplementation(() => mockTransport);

    // Mock MCP server
    const mockServer = {
      tool: jest.fn(),
      connect: jest.fn().mockResolvedValueOnce(undefined),
    };
    (McpServer as jest.Mock).mockImplementation(() => mockServer);

    // Setup cleanup handler
    mockResponseStream.on.mockImplementation((event: string, callback: () => void) => {
      if (event === 'close') {
        callback();
      }
      return mockResponseStream;
    });

    // Run handler
    await handler(event, mockResponseStream);

    // Verify MCP server setup
    expect(mockServer.tool).toHaveBeenCalledWith(
      'example',
      'An example tool',
      { input: 'string' },
      expect.any(Function),
    );

    expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);

    // Verify queue cleanup on close
    expect(sqsMock.commandCalls(DeleteQueueCommand)).toHaveLength(1);
    expect(sqsMock.commandCalls(DeleteQueueCommand)[0].args[0].input).toEqual({
      QueueUrl: 'test-queue-url',
    });
  });

  it('should handle registration loading errors', async () => {
    const event = createEvent();
    dynamoMock.on(ScanCommand).rejects(new Error('DynamoDB error'));

    await expect(handler(event, mockResponseStream)).rejects.toThrow('DynamoDB error');
  });

  it('should handle queue creation errors', async () => {
    const event = createEvent();
    dynamoMock.on(ScanCommand).resolves({ Items: [] });
    sqsMock.on(CreateQueueCommand).rejects(new Error('SQS error'));

    await expect(handler(event, mockResponseStream)).rejects.toThrow('SQS error');
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

    // Run handler and trigger close
    await handler(event, mockResponseStream);
    expect(mockResponseStream.on).toHaveBeenCalledWith('close', expect.any(Function));

    // Verify queue deletion
    expect(sqsMock.commandCalls(DeleteQueueCommand)).toHaveLength(1);
    expect(sqsMock.commandCalls(DeleteQueueCommand)[0].args[0].input).toEqual({
      QueueUrl: 'test-queue-url',
    });
  });
});
