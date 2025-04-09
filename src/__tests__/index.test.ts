jest.mock('lambda-stream', () => {
  const actualLambdaStream = jest.requireActual<typeof lambdaStream>('lambda-stream');

  return {
    ...actualLambdaStream,
    streamifyResponse: (
      handler: (event: APIGatewayProxyEventV2, responseStream: ResponseStream) => unknown,
    ): ((event: APIGatewayProxyEventV2, responseStream: ResponseStream) => unknown) => handler,
  };
});

let mockHandleSse: jest.Mock<void, [APIGatewayProxyEventV2, ResponseStream]>;
let mockHandleMessage: jest.Mock<Promise<APIGatewayProxyResultV2>, [APIGatewayProxyEventV2]>;

jest.mock('../lambdas/mcp/sse', () => {
  mockHandleSse = jest.fn<void, [APIGatewayProxyEventV2, ResponseStream]>();
  return {
    getSseHandler: (): jest.Mock<void, [APIGatewayProxyEventV2, ResponseStream]> => mockHandleSse,
  };
});

jest.mock('../lambdas/mcp/message', () => {
  mockHandleMessage = jest.fn<Promise<APIGatewayProxyResultV2>, [APIGatewayProxyEventV2]>();
  return {
    getMessageHandler: (): jest.Mock<Promise<APIGatewayProxyResultV2>, [APIGatewayProxyEventV2]> =>
      mockHandleMessage,
  };
});

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type * as lambdaStream from 'lambda-stream';
import { ResponseStream } from 'lambda-stream';

import { handler } from '../lambdas/mcp/index';

describe('index handler', () => {
  let mockResponseStream: ResponseStream & {
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    destroyed: boolean;
  };

  beforeEach(() => {
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
  });

  it('should route GET /sse to handleSse', async () => {
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: '',
      rawPath: '',
      rawQueryString: '',
      headers: {},
      requestContext: {
        accountId: '',
        apiId: '',
        domainName: '',
        domainPrefix: '',
        http: {
          method: 'GET',
          path: '/sse',
          protocol: 'HTTP/1.1',
          sourceIp: '',
          userAgent: '',
        },
        requestId: '',
        routeKey: '',
        stage: '',
        time: '',
        timeEpoch: 0,
      },
      isBase64Encoded: false,
    };

    await handler(event, mockResponseStream);

    expect(mockHandleSse).toHaveBeenCalledWith(event, mockResponseStream);
  });

  it('should route POST /message to handleMessage', async () => {
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: '',
      rawPath: '',
      rawQueryString: '',
      headers: {},
      requestContext: {
        accountId: '',
        apiId: '',
        domainName: '',
        domainPrefix: '',
        http: {
          method: 'POST',
          path: '/message',
          protocol: 'HTTP/1.1',
          sourceIp: '',
          userAgent: '',
        },
        requestId: '',
        routeKey: '',
        stage: '',
        time: '',
        timeEpoch: 0,
      },
      isBase64Encoded: false,
    };

    await handler(event, mockResponseStream);

    expect(mockHandleMessage).toHaveBeenCalledWith(event, mockResponseStream);
  });

  it('should return 404 for unknown routes', async () => {
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: '',
      rawPath: '',
      rawQueryString: '',
      headers: {},
      requestContext: {
        accountId: '',
        apiId: '',
        domainName: '',
        domainPrefix: '',
        http: {
          method: 'GET',
          path: '/unknown',
          protocol: 'HTTP/1.1',
          sourceIp: '',
          userAgent: '',
        },
        requestId: '',
        routeKey: '',
        stage: '',
        time: '',
        timeEpoch: 0,
      },
      isBase64Encoded: false,
    };

    await handler(event, mockResponseStream);

    expect(mockResponseStream.write).toHaveBeenCalledWith(JSON.stringify({ error: 'Not found' }));
    expect(mockResponseStream.end).toHaveBeenCalled();
  });
});
