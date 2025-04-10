import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { z } from 'zod';

export const ResourceParameters = z.object({
  uriTemplate: z.string().transform(value => new UriTemplate(value)),
  completions: z.record(z.function().returns(z.promise(z.array(z.string())))).optional(),
});

// Base schema for registration data
export const RegistrationSchema = z.object({
  id: z.string(),
  type: z.enum(['tool', 'resource', 'prompt']),
  name: z.string(),
  description: z.string(),
  lambdaArn: z.string().regex(/^arn:aws:lambda:/),
  parameters: z.record(z.any()),
});

export type Registration = z.infer<typeof RegistrationSchema>;

// Type for DynamoDB stored format
export type DynamoRegistration = Record<string, AttributeValue>;

// Utilities for converting between formats
export const toDynamoFormat = (registration: Registration): DynamoRegistration => {
  return marshall({
    ...registration,
    parameters: JSON.stringify(registration.parameters), // Always convert to string for storage
  });
};

export const fromDynamoFormat = (item: DynamoRegistration): Registration => {
  const raw = unmarshall(item);
  raw.parameters = JSON.parse(raw.parameters as string) as Record<string, unknown>;
  return RegistrationSchema.parse(raw);
};

// Helper for creating registration ID
export const createRegistrationId = (type: string, name: string): string => {
  return `${type}-${name}`; // Remove stackId prefix, just use type-name format
};

// Request schema (used for API requests, omits id as it's generated)
export const RegistrationRequestSchema = RegistrationSchema.omit({ id: true });

export type RegistrationRequest = z.infer<typeof RegistrationRequestSchema>;
