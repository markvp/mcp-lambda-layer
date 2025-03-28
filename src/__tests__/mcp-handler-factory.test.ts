/* eslint-disable @typescript-eslint/unbound-method */
import { Readable } from 'stream';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ResponseStream } from 'lambda-stream';

import { LambdaSSETransport } from '../lambda-sse-transport';
import { MCPHandlerFactory } from '../mcp-handler-factory';

// Extend the event type to allow Readable for body
type TestEvent = Omit<APIGatewayProxyEventV2, 'body'> & {
  body: Readable;
};

jest.mock('lambda-stream', () => ({
  ResponseStream: jest.fn().mockImplementation(() => ({
    write: jest.fn(),
    end: jest.fn(),
  })),
  streamifyResponse: jest.fn().mockImplementation((stream: Readable): Readable => stream),
}));

jest.mock('../lambda-sse-transport', () => ({
  LambdaSSETransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/server/mcp', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    tool: jest.fn(),
    resource: jest.fn(),
    prompt: jest.fn(),
  })),
}));

describe('MCPHandlerFactory', () => {
  let factory: MCPHandlerFactory;
  let mockResponseStream: jest.Mocked<ResponseStream>;
  let mockTransport: jest.Mocked<LambdaSSETransport>;
  let mockServer: jest.Mocked<McpServer>;

  beforeEach(() => {
    mockTransport = {
      initiateResponse: jest.fn(),
      start: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      handleMessage: jest.fn(),
    } as unknown as jest.Mocked<LambdaSSETransport>;
    (LambdaSSETransport as jest.Mock).mockReturnValue(mockTransport);

    mockServer = {
      connect: jest.fn(),
      tool: jest.fn(),
      resource: jest.fn(),
      prompt: jest.fn(),
    } as unknown as jest.Mocked<McpServer>;
    (McpServer as jest.Mock).mockReturnValue(mockServer);

    factory = new MCPHandlerFactory();
    mockResponseStream = new ResponseStream() as jest.Mocked<ResponseStream>;
  });

  describe('constructor', () => {
    it('should create a new instance with default config', () => {
      expect(factory).toBeInstanceOf(MCPHandlerFactory);
    });

    it('should create a new instance with custom config', () => {
      const config = {
        tools: {
          testTool: {
            handler: jest.fn(),
          },
        },
        resources: {
          testResource: {
            template: 'test',
            handler: jest.fn(),
          },
        },
        prompts: {
          testPrompt: {
            description: 'test',
            handler: jest.fn(),
          },
        },
      };
      const customFactory = new MCPHandlerFactory(config);
      expect(customFactory).toBeInstanceOf(MCPHandlerFactory);
    });
  });

  describe('getHandler', () => {
    it('should create a handler that processes the event stream', async () => {
      const handler = factory.getHandler();
      const event: TestEvent = {
        version: '2.0',
        routeKey: 'POST /',
        rawPath: '/',
        rawQueryString: '',
        headers: {},
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'id.execute-api.us-east-1.amazonaws.com',
          domainPrefix: 'id',
          http: {
            method: 'POST',
            path: '/',
            protocol: 'HTTP/1.1',
            sourceIp: 'IP',
            userAgent: 'agent',
          },
          requestId: 'id',
          routeKey: 'POST /',
          stage: '$default',
          time: '12/Mar/2020:19:03:58 +0000',
          timeEpoch: 1583348638390,
        },
        body: new Readable({
          read(): void {
            this.push(Buffer.from(JSON.stringify({ test: 'data' })));
            this.push(null);
          },
        }),
        isBase64Encoded: false,
      };

      await handler(event as unknown as APIGatewayProxyEventV2, mockResponseStream);

      // Verify transport was initialized and used correctly
      expect(mockTransport.initiateResponse).toHaveBeenCalledWith(mockResponseStream);
      expect(mockTransport.handleMessage).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should handle errors during stream processing', async () => {
      const handler = factory.getHandler();
      const event: TestEvent = {
        version: '2.0',
        routeKey: 'POST /',
        rawPath: '/',
        rawQueryString: '',
        headers: {},
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'id.execute-api.us-east-1.amazonaws.com',
          domainPrefix: 'id',
          http: {
            method: 'POST',
            path: '/',
            protocol: 'HTTP/1.1',
            sourceIp: 'IP',
            userAgent: 'agent',
          },
          requestId: 'id',
          routeKey: 'POST /',
          stage: '$default',
          time: '12/Mar/2020:19:03:58 +0000',
          timeEpoch: 1583348638390,
        },
        body: new Readable({
          read(): void {
            this.push(Buffer.from(JSON.stringify({ test: 'data' })));
            this.push(null);
          },
        }),
        isBase64Encoded: false,
      };

      mockTransport.handleMessage.mockImplementation(() => {
        throw new Error('Stream error');
      });

      await expect(
        handler(event as unknown as APIGatewayProxyEventV2, mockResponseStream),
      ).rejects.toThrow('Stream error');

      // Verify transport was cleaned up even on error
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should clean up resources after processing', async () => {
      const handler = factory.getHandler();
      const event: TestEvent = {
        version: '2.0',
        routeKey: 'POST /',
        rawPath: '/',
        rawQueryString: '',
        headers: {},
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'id.execute-api.us-east-1.amazonaws.com',
          domainPrefix: 'id',
          http: {
            method: 'POST',
            path: '/',
            protocol: 'HTTP/1.1',
            sourceIp: 'IP',
            userAgent: 'agent',
          },
          requestId: 'id',
          routeKey: 'POST /',
          stage: '$default',
          time: '12/Mar/2020:19:03:58 +0000',
          timeEpoch: 1583348638390,
        },
        body: new Readable({
          read(): void {
            this.push(Buffer.from(JSON.stringify({ test: 'data' })));
            this.push(null);
          },
        }),
        isBase64Encoded: false,
      };

      await handler(event as unknown as APIGatewayProxyEventV2, mockResponseStream);

      // Verify transport was cleaned up
      expect(mockTransport.close).toHaveBeenCalled();
    });
  });
});
