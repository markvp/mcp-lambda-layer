import { z, ZodTypeAny, ZodRawShape } from 'zod';

type JsonSchemaDescriptor =
  | 'string'
  | 'number'
  | 'boolean'
  | { type: 'string'; optional?: boolean }
  | { type: 'number'; optional?: boolean }
  | { type: 'boolean'; optional?: boolean }
  | { type: 'array'; items: JsonSchemaDescriptor; optional?: boolean }
  | { type: 'object'; properties: Record<string, JsonSchemaDescriptor>; optional?: boolean };

type SchemaMap = Record<string, JsonSchemaDescriptor>;

function buildZodType(descriptor: JsonSchemaDescriptor): ZodTypeAny {
  if (typeof descriptor === 'string') {
    switch (descriptor) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'boolean':
        return z.boolean();
      default:
        throw new Error(`Unsupported primitive type: ${String(descriptor)}`);
    }
  }

  switch (descriptor.type) {
    case 'string':
      return descriptor.optional ? z.string().optional() : z.string();
    case 'number':
      return descriptor.optional ? z.number().optional() : z.number();
    case 'boolean':
      return descriptor.optional ? z.boolean().optional() : z.boolean();
    case 'array':
      return descriptor.optional
        ? z.array(buildZodType(descriptor.items)).optional()
        : z.array(buildZodType(descriptor.items));
    case 'object': {
      const shape: ZodRawShape = {};
      for (const [key, value] of Object.entries(descriptor.properties)) {
        shape[key] = buildZodType(value);
      }
      return descriptor.optional ? z.object(shape).optional() : z.object(shape);
    }
    default:
      throw new Error(`Unsupported type object: ${JSON.stringify(descriptor)}`);
  }
}

export function jsonToZodSchema(descriptor: SchemaMap): z.ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};
  for (const [key, value] of Object.entries(descriptor)) {
    shape[key] = buildZodType(value);
  }
  return z.object(shape);
}
