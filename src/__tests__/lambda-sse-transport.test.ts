import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { ResponseStream } from 'lambda-stream';

import { LambdaSSETransport } from '../lambdas/sse/lambda-sse-transport';

describe('LambdaSSETransport', () => {
  let transport: LambdaSSETransport;
  let mockResponseStream: jest.Mocked<ResponseStream>;

  beforeEach((): void => {
    mockResponseStream = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      //   .mockImplementation(function (this: void, event: string, callback: () => void) {
      //   if (event === 'close') {
      //     callback();
      //   }
      //   return mockResponseStream;
      // }),
      destroyed: false,
    } as unknown as jest.Mocked<ResponseStream>;

    transport = new LambdaSSETransport('https://test-endpoint', mockResponseStream);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    const testInit = (): void => {
      expect(transport.sessionId).toBeTruthy();
      expect(transport).toBeInstanceOf(LambdaSSETransport);
      expect(transport).toMatchObject({
        sessionId: expect.any(String) as string,
      });
    };

    it('should initialize with endpoint and response stream', testInit);

    const testInterface = (): void => {
      const transportInstance: Transport = transport;
      expect(transportInstance).toHaveProperty('start');
      expect(transportInstance).toHaveProperty('send');
      expect(transportInstance).toHaveProperty('close');
    };

    it('should implement Transport interface', testInterface);
  });

  describe('start', () => {
    it('should write SSE headers and endpoint info', async (): Promise<void> => {
      const expectedHeaders = new TextEncoder().encode(
        'Content-Type: text/event-stream\n' +
          'Cache-Control: no-cache\n' +
          'Connection: keep-alive\n' +
          'Access-Control-Allow-Origin: *\n\n',
      );

      const expectedEndpoint = new TextEncoder().encode(
        'event: endpoint\n' + `data: https://test-endpoint?sessionId=${transport.sessionId}\n\n`,
      );

      await transport.start();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockResponseStream.write).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockResponseStream.write).toHaveBeenNthCalledWith(1, expectedHeaders);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockResponseStream.write).toHaveBeenNthCalledWith(2, expectedEndpoint);
    });

    const testCleanup = async (): Promise<void> => {
      await transport.start();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockResponseStream.on).toHaveBeenCalledWith('close', expect.any(Function));
    };

    it('should register cleanup on stream close', testCleanup);

    it('should throw error if response stream is not available', async (): Promise<void> => {
      transport['responseStream'] = undefined;
      await expect(transport.start()).rejects.toThrow('No response stream available');
    });
  });

  describe('send', () => {
    it('should write message as SSE event', async (): Promise<void> => {
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        params: { foo: 'bar' },
        id: 1,
      };
      const expectedMessage = new TextEncoder().encode(
        'event: message\n' + `data: ${JSON.stringify(message)}\n\n`,
      );

      await transport.send(message);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockResponseStream.write).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockResponseStream.write).toHaveBeenNthCalledWith(1, expectedMessage);
    });

    it('should throw error if not connected', async (): Promise<void> => {
      transport['responseStream'] = undefined;
      await expect(transport.send({} as JSONRPCMessage)).rejects.toThrow('Not connected');
    });
  });

  describe('close', () => {
    it('should end response stream and call onclose handler', async (): Promise<void> => {
      const onclose = jest.fn();
      transport.onclose = onclose;

      await transport.close();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockResponseStream.end).toHaveBeenCalled();
      expect(onclose).toHaveBeenCalled();
      expect(transport['responseStream']).toBeUndefined();
    });

    it('should handle close even if response stream is already undefined', async (): Promise<void> => {
      transport['responseStream'] = undefined;
      await expect(transport.close()).resolves.not.toThrow();
    });

    it('should call onclose even if end throws', async (): Promise<void> => {
      const onclose = jest.fn();
      transport.onclose = onclose;
      mockResponseStream.end.mockImplementation(() => {
        throw new Error('End failed');
      });

      await transport.close();

      expect(onclose).toHaveBeenCalled();
      expect(transport['responseStream']).toBeUndefined();
    });
  });

  describe('handleMessage', () => {
    it('should validate and forward JSON-RPC messages', () => {
      const onmessage = jest.fn();
      transport.onmessage = onmessage;

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        params: { foo: 'bar' },
        id: 1,
      };

      const result = transport.handleMessage(JSON.stringify(message));

      expect(onmessage).toHaveBeenCalledWith(message);
      expect(result).toBeInstanceOf(Uint8Array);

      const response = new TextDecoder().decode(result);
      expect(response).toContain('event: message');
      const parsedResponse = JSON.parse(response.split('data: ')[1]) as JSONRPCMessage;
      expect(parsedResponse).toEqual(message);
    });

    it('should throw error for invalid JSON-RPC messages', () => {
      const onerror = jest.fn();
      transport.onerror = onerror;

      const invalidMessage = { invalid: 'message' };

      expect(() => transport.handleMessage(JSON.stringify(invalidMessage))).toThrow();
      expect(onerror).toHaveBeenCalled();
    });

    it('should throw error if not connected', () => {
      transport['responseStream'] = undefined;
      expect(() => transport.handleMessage('{"valid":"json"}')).toThrow('Not connected');
    });
  });
});
