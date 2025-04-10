import { randomUUID } from 'crypto';

import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { ResponseStream } from 'lambda-stream';

const SSE_HEADERS = `Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *

`;

export class LambdaSSETransport implements Transport {
  private responseStream?: ResponseStream;
  private endpoint: string;
  public sessionId: string;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  public constructor(endpoint: string, responseStream: ResponseStream) {
    this.sessionId = randomUUID();
    this.endpoint = endpoint;
    this.responseStream = responseStream;
  }

  private buildResponse(messageType: string, data: string): Uint8Array {
    const response = `event: ${messageType}
data: ${data}

`;
    return new TextEncoder().encode(response);
  }

  public async start(): Promise<void> {
    if (!this.responseStream) {
      throw new Error('No response stream available');
    }

    this.responseStream.on('close', () => void this.close());
    this.responseStream.write(new TextEncoder().encode(SSE_HEADERS));
    this.responseStream.write(
      this.buildResponse('endpoint', `${encodeURI(this.endpoint)}?sessionId=${this.sessionId}`),
    );

    await Promise.resolve();
  }

  public async send(message: JSONRPCMessage): Promise<void> {
    if (!this.responseStream) {
      throw new Error('Not connected');
    }

    this.responseStream.write(this.buildResponse('message', JSON.stringify(message)));

    await Promise.resolve();
  }

  public async close(): Promise<void> {
    try {
      if (this.responseStream && !this.responseStream.destroyed) {
        this.responseStream.end();
      }
    } catch (error) {
      // Ignore stream end errors
    }
    this.responseStream = undefined;
    this.onclose?.();

    await Promise.resolve();
  }

  public handleMessage(message: string): void {
    if (!this.responseStream) {
      throw new Error('Not connected');
    }

    try {
      const parsedMessage = JSONRPCMessageSchema.parse(JSON.parse(message));
      this.onmessage?.(parsedMessage);
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }
  }
}
