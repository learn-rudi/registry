function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expectedType) {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return isObject(value);
  if (expectedType === 'integer') return Number.isInteger(value);
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expectedType === 'null') return value === null;
  return typeof value === expectedType;
}

function typeMatches(value, expectedTypes) {
  const types = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
  return types.some((type) => matchesType(value, type));
}

function formatPath(pathParts) {
  if (pathParts.length === 0) return '$';
  return `$${pathParts.map((part) => (
    typeof part === 'number' ? `[${part}]` : `.${part}`
  )).join('')}`;
}

function validateString(value, schema, pathParts, errors) {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${formatPath(pathParts)} must have length >= ${schema.minLength}`);
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${formatPath(pathParts)} must have length <= ${schema.maxLength}`);
  }

  if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) {
    errors.push(`${formatPath(pathParts)} must match ${schema.pattern}`);
  }

  if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
    errors.push(`${formatPath(pathParts)} must be a valid date-time string`);
  }
}

function validateNumber(value, schema, pathParts, errors) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${formatPath(pathParts)} must be >= ${schema.minimum}`);
  }

  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    errors.push(`${formatPath(pathParts)} must be > ${schema.exclusiveMinimum}`);
  }

  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${formatPath(pathParts)} must be <= ${schema.maximum}`);
  }

  if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
    errors.push(`${formatPath(pathParts)} must be < ${schema.exclusiveMaximum}`);
  }
}

function validateArray(value, schema, pathParts, errors, rootSchema) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push(`${formatPath(pathParts)} must contain at least ${schema.minItems} items`);
  }

  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push(`${formatPath(pathParts)} must contain at most ${schema.maxItems} items`);
  }

  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((itemSchema, index) => {
      if (index < value.length) {
        validateNode(value[index], itemSchema, [...pathParts, index], errors, rootSchema);
      }
    });
  }

  if (schema.items && !Array.isArray(schema.items)) {
    value.forEach((item, index) => {
      if (!schema.prefixItems || index >= schema.prefixItems.length) {
        validateNode(item, schema.items, [...pathParts, index], errors, rootSchema);
      }
    });
  }
}

function validateObject(value, schema, pathParts, errors, rootSchema) {
  const properties = schema.properties || {};
  const required = schema.required || [];

  for (const key of required) {
    if (value[key] === undefined) {
      errors.push(`${formatPath([...pathParts, key])} is required`);
    }
  }

  for (const [key, child] of Object.entries(properties)) {
    if (value[key] !== undefined) {
      validateNode(value[key], child, [...pathParts, key], errors, rootSchema);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        errors.push(`${formatPath([...pathParts, key])} is not allowed`);
      }
    }
  }
}

function resolveLocalRef(rootSchema, reference) {
  if (!reference.startsWith('#/')) {
    return null;
  }
  return reference.slice(2).split('/').reduce((node, rawPart) => {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    return node && Object.hasOwn(node, part) ? node[part] : null;
  }, rootSchema);
}

function validateNode(value, schema, pathParts, errors, rootSchema) {
  if (schema.$ref) {
    const referencedSchema = resolveLocalRef(rootSchema, schema.$ref);
    if (!referencedSchema) {
      errors.push(`${formatPath(pathParts)} uses unsupported schema reference ${schema.$ref}`);
      return;
    }
    validateNode(value, referencedSchema, pathParts, errors, rootSchema);
    return;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${formatPath(pathParts)} must equal ${JSON.stringify(schema.const)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${formatPath(pathParts)} must be one of ${schema.enum.map(JSON.stringify).join(', ')}`);
    return;
  }

  if (schema.type && !typeMatches(value, schema.type)) {
    const expected = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type;
    errors.push(`${formatPath(pathParts)} must be ${expected}, got ${describeType(value)}`);
    return;
  }

  if (typeof value === 'string') {
    validateString(value, schema, pathParts, errors);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    validateNumber(value, schema, pathParts, errors);
  }

  if (Array.isArray(value)) {
    validateArray(value, schema, pathParts, errors, rootSchema);
  }

  if (isObject(value)) {
    validateObject(value, schema, pathParts, errors, rootSchema);
  }
}

export function validateJsonSchema(value, schema, label = 'value') {
  const errors = [];
  validateNode(value, schema, [], errors, schema);

  if (errors.length === 0) {
    return;
  }

  const shown = errors.slice(0, 12);
  const suffix = errors.length > shown.length
    ? `\n- ... ${errors.length - shown.length} more error(s)`
    : '';
  throw new Error(`${label} failed schema validation:\n- ${shown.join('\n- ')}${suffix}`);
}
