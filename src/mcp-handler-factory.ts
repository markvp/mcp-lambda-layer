import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import {
  McpServer,
  ToolCallback,
  ReadResourceCallback,
  PromptCallback,
} from '@modelcontextprotocol/sdk/server/mcp';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { RequestHandler, ResponseStream, streamifyResponse } from 'lambda-stream';
import { ZodRawShape, ZodType, ZodTypeDef, ZodOptional } from 'zod';

import { LambdaSSETransport } from './lambda-sse-transport';

export type PromptArgsRawShape = {
  [k: string]:
    | ZodType<string, ZodTypeDef, string>
    | ZodOptional<ZodType<string, ZodTypeDef, string>>;
};

export interface McpServerConfig {
  tools?: {
    [name: string]:
      | {
          params: ZodRawShape;
          handler: ToolCallback<ZodRawShape>;
        }
      | {
          handler: ToolCallback;
        };
  };
  resources?: {
    [name: string]: {
      template: string;
      handler: ReadResourceCallback;
    };
  };
  prompts?: {
    [name: string]:
      | {
          description: string;
          handler: PromptCallback;
        }
      | {
          args: PromptArgsRawShape;
          handler: PromptCallback<PromptArgsRawShape>;
        };
  };
}

export class MCPHandlerFactory {
  private server: McpServer;
  private transport: LambdaSSETransport;

  public constructor(config: McpServerConfig = {}) {
    this.transport = new LambdaSSETransport();
    this.server = new McpServer({
      name: 'MCP Lambda Server',
      version: '1.0.7',
    });

    if (config.tools) {
      for (const [name, tool] of Object.entries(config.tools)) {
        if ('params' in tool) {
          this.server.tool(name, tool.params, tool.handler);
        } else {
          this.server.tool(name, tool.handler);
        }
      }
    }

    if (config.resources) {
      for (const [name, resource] of Object.entries(config.resources)) {
        this.server.resource(name, resource.template, resource.handler);
      }
    }

    if (config.prompts) {
      for (const [name, prompt] of Object.entries(config.prompts)) {
        if ('description' in prompt) {
          this.server.prompt(name, prompt.description, prompt.handler);
        } else {
          this.server.prompt(name, prompt.args, prompt.handler);
        }
      }
    }
  }

  public getHandler(): RequestHandler {
    return streamifyResponse(
      async (event: APIGatewayProxyEventV2, responseStream: ResponseStream) => {
        try {
          // Set up the response stream and start the transport
          this.transport.initiateResponse(responseStream);

          await this.server.connect(this.transport);
          // Create a readable stream from the event
          const eventStream = Readable.from(Buffer.from(JSON.stringify(event)));

          // Process the stream using pipeline
          await pipeline(
            eventStream,
            async function* (
              this: MCPHandlerFactory,
              source: Readable,
            ): AsyncGenerator<Uint8Array, void, unknown> {
              for await (const chunk of source) {
                const text = new TextDecoder().decode(chunk as Uint8Array);
                const response = this.transport.handleMessage(text);
                if (response) {
                  yield new TextEncoder().encode(response);
                }
              }
            }.bind(this),
            responseStream,
          );
        } catch (error) {
          console.error('Error processing stream:', error);
          throw error;
        } finally {
          // Clean up resources
          await this.transport.close();
        }
      },
    );
  }
}
