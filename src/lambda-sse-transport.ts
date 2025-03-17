import { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import { JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types';
import { ResponseStream } from 'lambda-stream';

export class LambdaSSETransport implements Transport {
  private responseStream?: ResponseStream;
  public sessionId: string;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  public constructor() {
    this.sessionId = `lambda-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  public initiateResponse(responseStream: ResponseStream): void {
    if (this.responseStream) {
      throw new Error('Response stream already available');
    }

    this.responseStream = responseStream;
  }

  public async start(): Promise<void> {
    if (!this.responseStream) {
      throw new Error('No response stream available');
    }

    // Write initial SSE headers
    this.responseStream.write(
      new TextEncoder().encode(
        'Content-Type: text/event-stream\n' +
          'Cache-Control: no-cache\n' +
          'Connection: keep-alive\n' +
          'Access-Control-Allow-Origin: *\n\n',
      ),
    );

    await Promise.resolve();
  }

  public async send(message: JSONRPCMessage): Promise<void> {
    if (!this.responseStream) {
      throw new Error('Not connected');
    }

    this.responseStream.write(
      new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`),
    );

    await Promise.resolve();
  }

  public async close(): Promise<void> {
    if (this.responseStream) {
      try {
        this.responseStream.end();
      } finally {
        this.responseStream = undefined;
      }
    }
    this.onclose?.();

    await Promise.resolve();
  }

  public handleMessage(message: unknown): string {
    if (!this.responseStream) {
      throw new Error('Not connected');
    }

    try {
      const parsedMessage = JSONRPCMessageSchema.parse(message);
      this.onmessage?.(parsedMessage);

      return (
        'HTTP/1.1 202 Accepted\n' +
        'Content-Type: application/json\n' +
        'Access-Control-Allow-Origin: *\n\n' +
        JSON.stringify({ status: 'Accepted' }) +
        '\n'
      );
    } catch (error) {
      this.onerror?.(error as Error);

      return (
        'HTTP/1.1 400 Bad Request\n' +
        'Content-Type: application/json\n' +
        'Access-Control-Allow-Origin: *\n\n' +
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: error instanceof Error ? error.message : 'Parse error',
          },
          id: null,
        }) +
        '\n'
      );
    }
  }
}
