/* eslint-disable @typescript-eslint/unbound-method */
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types';
import { ResponseStream } from 'lambda-stream';

import { LambdaSSETransport } from '../lambda-sse-transport';

jest.mock('lambda-stream', () => ({
  ResponseStream: jest.fn().mockImplementation(() => ({
    write: jest.fn(),
    end: jest.fn(),
  })),
}));

describe('LambdaSSETransport', () => {
  let transport: LambdaSSETransport;
  let mockResponseStream: jest.Mocked<ResponseStream>;

  beforeEach(() => {
    jest.useFakeTimers();
    transport = new LambdaSSETransport();
    mockResponseStream = new ResponseStream() as jest.Mocked<ResponseStream>;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should generate a unique session ID', () => {
      expect(transport.sessionId).toMatch(/^lambda-\d+-[a-z0-9]+$/);
    });
  });

  describe('initiateResponse', () => {
    it('should set the response stream', () => {
      transport.initiateResponse(mockResponseStream);
      expect(transport['responseStream']).toBe(mockResponseStream);
    });

    it('should throw if response stream is already set', () => {
      transport.initiateResponse(mockResponseStream);
      expect(() => transport.initiateResponse(mockResponseStream)).toThrow(
        'Response stream already available',
      );
    });
  });

  describe('start', () => {
    it('should write SSE headers', async () => {
      transport.initiateResponse(mockResponseStream);
      await transport.start();

      expect(mockResponseStream.write).toHaveBeenCalledWith(expect.any(Uint8Array));
      const headers = new TextDecoder().decode(
        mockResponseStream.write.mock.calls[0][0] as Uint8Array,
      );
      expect(headers).toContain('Content-Type: text/event-stream');
      expect(headers).toContain('Cache-Control: no-cache');
      expect(headers).toContain('Connection: keep-alive');
      expect(headers).toContain('Access-Control-Allow-Origin: *');
    });

    it('should throw if response stream is not set', async () => {
      await expect(transport.start()).rejects.toThrow('No response stream available');
    });
  });

  describe('send', () => {
    it('should format and write message as SSE', async () => {
      transport.initiateResponse(mockResponseStream);
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        params: {},
        id: 1,
      };

      await transport.send(message);

      expect(mockResponseStream.write).toHaveBeenCalledWith(expect.any(Uint8Array));
      const sseMessage = new TextDecoder().decode(
        mockResponseStream.write.mock.calls[0][0] as Uint8Array,
      );
      expect(sseMessage).toBe(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    });

    it('should throw if not connected', async () => {
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        params: {},
        id: 1,
      };

      await expect(transport.send(message)).rejects.toThrow('Not connected');
    });
  });

  describe('close', () => {
    it('should end the response stream and call onclose handler', async () => {
      const onclose = jest.fn();
      transport.onclose = onclose;
      transport.initiateResponse(mockResponseStream);

      await transport.close();

      expect(mockResponseStream.end).toHaveBeenCalled();
      expect(transport['responseStream']).toBeUndefined();
      expect(onclose).toHaveBeenCalled();
    });

    it('should not throw if response stream is not set', async () => {
      await expect(transport.close()).resolves.toBeUndefined();
    });
  });

  describe('handleMessage', () => {
    it('should process valid message and send success response', () => {
      transport.initiateResponse(mockResponseStream);
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        params: {},
        id: 1,
      };

      const onmessage = jest.fn();
      transport.onmessage = onmessage;

      expect(transport.handleMessage(message)).toContain('HTTP/1.1 202 Accepted');

      expect(onmessage).toHaveBeenCalledWith(message);
    });

    it('should handle invalid message and send error response', () => {
      transport.initiateResponse(mockResponseStream);
      const onerror = jest.fn();
      transport.onerror = onerror;

      const invalidMessage = { invalid: 'message' };

      expect(transport.handleMessage(invalidMessage)).toContain('HTTP/1.1 400 Bad Request');
      expect(onerror).toHaveBeenCalled();
    });

    it('should throw if not connected', () => {
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        params: {},
        id: 1,
      };

      expect(() => transport.handleMessage(message)).toThrow('Not connected');
    });
  });
});
