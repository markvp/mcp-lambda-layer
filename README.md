# MCP Lambda Server

A Node.js package that provides MCP (Model Context Protocol) server infrastructure for AWS Lambda functions with SSE support.

## Features

- Adapts the MCP TypeScript SDK to work with AWS Lambda
- Supports Server-Sent Events (SSE) through Lambda response streaming
- Handles CORS and HTTP method validation
- TypeScript support

## Important Notes

- Lambda response streaming **only works with Function URLs**. It does not work with API Gateway or Application Load Balancer.
- Only Node.js runtime is officially supported for response streaming.

## Installation

```bash
npm install @markvp/mcp-lambda-layer
```

## Usage

Create your Lambda function and import the package:

```typescript
import { MCPHandlerFactory } from '@markvp/mcp-lambda-layer';
import { z } from 'zod';

// Create MCP handler factory with your configuration
const factory = new MCPHandlerFactory({
  tools: {
    summarize: {
      params: {
        text: z.string(),
      },
      handler: async ({ text }) => {
        // Your implementation here - could be any service/model/API
        const summary = await yourSummarizeImplementation(text);
        return {
          content: [{ type: 'text', text: summary }],
        };
      },
    },
  },
  prompts: {
    generate: {
      description: 'Generate content based on a prompt',
      handler: async extra => {
        // Your implementation here - could be any service/model/API
        const result = await yourGenerateImplementation(extra.prompt);
        return {
          content: [{ type: 'text', text: result }],
        };
      },
    },
  },
});

// Export the handler directly
export const handler = factory.getHandler();
```

### Required Lambda Configuration

- Runtime: Node.js 18.x or later
- Handler: index.handler
- Memory: 128 MB minimum (adjust based on your needs)
- Timeout: 120 seconds recommended
- Function URL: Required and must have response streaming enabled
- API Gateway/ALB: Not supported with streaming

### Package Contents

This package provides:

- MCP Server implementation with SSE transport
- Protocol handling (JSON-RPC)
- Streaming response support
- Type definitions and interfaces

Your Lambda function provides:

- Tool and prompt implementations
- Business logic
- Any necessary API clients or services
- Configuration

## License

MIT
