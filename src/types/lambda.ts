import {
  CallToolResult,
  GetPromptResult,
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Define our own result type since APIGatewayProxyResultV2 is a union type
export interface APIGatewayResult {
  statusCode: number;
  body?: string;
  headers?: Record<string, string | number | boolean>;
  isBase64Encoded?: boolean;
}

export interface LambdaResponse<T> {
  statusCode: number;
  body: T;
}

export const LambdaResponseSchema = <T>(
  bodySchema: z.ZodType<T>,
): z.ZodType<T, z.ZodTypeDef, unknown> =>
  z
    .object({
      statusCode: z.number(),
      body: bodySchema,
    })
    .transform(({ body }): T => bodySchema.parse(body));

export function decodeLambdaResponse<T>(payload: Uint8Array, bodySchema: z.ZodType<T>): T {
  return LambdaResponseSchema(bodySchema).parse(JSON.parse(new TextDecoder().decode(payload)));
}

export const ResponseBodySchema = {
  tool: z.custom<CallToolResult>(),
  prompt: z.custom<GetPromptResult>(),
  listResource: z.custom<ListResourcesResult>(),
  readResource: z.custom<ReadResourceResult>(),
};

export type LambdaToolResponse = LambdaResponse<CallToolResult>;
export type LambdaPromptResponse = LambdaResponse<GetPromptResult>;
export type LambdaListResourceResponse = LambdaResponse<ListResourcesResult>;
export type LambdaReadResourceResponse = LambdaResponse<ReadResourceResult>;
