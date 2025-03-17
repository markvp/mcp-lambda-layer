export { MCPHandlerFactory } from './mcp-handler-factory';

// Re-export types from our implementation
export type { McpServerConfig, PromptArgsRawShape } from './mcp-handler-factory';

// Re-export necessary types from the MCP SDK
export type {
  ToolCallback,
  ReadResourceCallback,
  PromptCallback,
} from '@modelcontextprotocol/sdk/server/mcp';
