import { z } from 'zod';
import datamodel from '../datamodel.json' assert { type: 'json' };

/**
 * Convert a JSON Schema property definition to a Zod schema type.
 */
function jsonSchemaPropertyToZod(propName, propDef, requiredFields = []) {
  let zodType;

  // Lookup (x-lookup extension) — object with _id
  if (propDef['x-lookup']) {
    zodType = z.object({ _id: z.string() }).passthrough();
  // Enum takes precedence over base type
  } else if (propDef.enum) {
    zodType = z.enum(propDef.enum);
  } else {
    switch (propDef.type) {
      case 'string':
        zodType = z.string();
        if (propDef.minLength) zodType = zodType.min(propDef.minLength);
        if (propDef.maxLength) zodType = zodType.max(propDef.maxLength);
        if (propDef.format === 'email') zodType = zodType.email();
        if (propDef.format === 'url') zodType = zodType.url();
        if (propDef.format === 'file' || propDef.format === 'image') zodType = zodType.nullable();
        break;
      case 'number':
        zodType = z.number();
        if (propDef.minimum !== undefined) zodType = zodType.min(propDef.minimum);
        if (propDef.maximum !== undefined) zodType = zodType.max(propDef.maximum);
        break;
      case 'integer':
        zodType = z.number().int();
        if (propDef.minimum !== undefined) zodType = zodType.min(propDef.minimum);
        if (propDef.maximum !== undefined) zodType = zodType.max(propDef.maximum);
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.any());
        break;
      default:
        zodType = z.any();
    }
  }

  if (propDef.title) zodType = zodType.describe(propDef.title);
  if (propDef.default !== undefined) zodType = zodType.default(propDef.default);
  if (!requiredFields.includes(propName)) zodType = zodType.optional();

  return zodType;
}

/**
 * Build Zod schemas for all collections defined in datamodel.json.
 * Returns { collectionName: zodSchema, ... }
 */
export function buildSchemas() {
  const schemas = {};
  for (const [collectionName, config] of Object.entries(datamodel.collections)) {
    const shape = {};
    const required = config.schema.required || [];
    for (const [propName, propDef] of Object.entries(config.schema.properties)) {
      shape[propName] = jsonSchemaPropertyToZod(propName, propDef, required);
    }
    schemas[collectionName] = z.object(shape);
  }
  return schemas;
}

export { datamodel };
