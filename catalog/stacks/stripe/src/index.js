#!/usr/bin/env node
'use strict';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const PROTOCOL_VERSION = '2024-11-05';
const API_KEY = process.env.STRIPE_API_KEY || '';

const TOOLS = [
  {
    name: 'stripe_config_status',
    description: 'Check whether Stripe credentials are configured without revealing secret values.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stripe_list_products',
    description: 'List Stripe products. This is read-only and returns a compact product summary.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of products to return. Default 10.',
        },
        active: {
          type: 'boolean',
          description: 'Optional active filter.',
        },
      },
    },
  },
  {
    name: 'stripe_list_prices',
    description: 'List Stripe prices. This is read-only and returns a compact price summary.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of prices to return. Default 10.',
        },
        product: {
          type: 'string',
          description: 'Optional Stripe product ID to filter prices.',
        },
        active: {
          type: 'boolean',
          description: 'Optional active filter.',
        },
        currency: {
          type: 'string',
          description: 'Optional three-letter currency filter, e.g. usd.',
        },
      },
    },
  },
  {
    name: 'stripe_create_product',
    description: 'Create a Stripe product. Defaults to dry-run unless confirm_create is true.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Customer-visible product name.',
        },
        description: {
          type: 'string',
          description: 'Optional customer-visible product description.',
        },
        statement_descriptor: {
          type: 'string',
          description: 'Optional statement descriptor. Stripe length and character rules still apply.',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Optional metadata. Values are converted to strings.',
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional Stripe idempotency key for retry safety.',
        },
        confirm_create: {
          type: 'boolean',
          description: 'Must be true to perform the Stripe write. Omit for dry-run.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Set true to force dry-run even when confirm_create is true.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'stripe_create_price',
    description: 'Create a one-time Stripe price for an existing product. Defaults to dry-run unless confirm_create is true.',
    inputSchema: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          description: 'Stripe product ID, e.g. prod_...',
        },
        unit_amount: {
          type: 'integer',
          minimum: 1,
          description: 'Amount in the smallest currency unit, e.g. 100000 for $1,000.00 USD.',
        },
        currency: {
          type: 'string',
          description: 'Three-letter currency. Default usd.',
        },
        nickname: {
          type: 'string',
          description: 'Optional internal price nickname.',
        },
        lookup_key: {
          type: 'string',
          description: 'Optional lookup key for retrieving the price later.',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Optional metadata. Values are converted to strings.',
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional Stripe idempotency key for retry safety.',
        },
        confirm_create: {
          type: 'boolean',
          description: 'Must be true to perform the Stripe write. Omit for dry-run.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Set true to force dry-run even when confirm_create is true.',
        },
      },
      required: ['product', 'unit_amount'],
    },
  },
  {
    name: 'stripe_create_payment_link',
    description: 'Create a Stripe Payment Link from an existing price. Defaults to dry-run unless confirm_create is true.',
    inputSchema: {
      type: 'object',
      properties: {
        price: {
          type: 'string',
          description: 'Stripe price ID, e.g. price_...',
        },
        quantity: {
          type: 'integer',
          minimum: 1,
          maximum: 999999,
          description: 'Line item quantity. Default 1.',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Optional metadata. Values are converted to strings.',
        },
        after_completion_url: {
          type: 'string',
          description: 'Optional HTTPS URL to redirect to after successful payment.',
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional Stripe idempotency key for retry safety.',
        },
        confirm_create: {
          type: 'boolean',
          description: 'Must be true to perform the Stripe write. Omit for dry-run.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Set true to force dry-run even when confirm_create is true.',
        },
      },
      required: ['price'],
    },
  },
  {
    name: 'stripe_create_one_time_payment_link',
    description: 'Create a product, one-time price, and Payment Link in one guarded workflow. Defaults to dry-run unless confirm_create is true.',
    inputSchema: {
      type: 'object',
      properties: {
        product_name: {
          type: 'string',
          description: 'Customer-visible product name.',
        },
        unit_amount: {
          type: 'integer',
          minimum: 1,
          description: 'Amount in the smallest currency unit, e.g. 100000 for $1,000.00 USD.',
        },
        currency: {
          type: 'string',
          description: 'Three-letter currency. Default usd.',
        },
        description: {
          type: 'string',
          description: 'Optional customer-visible product description.',
        },
        price_nickname: {
          type: 'string',
          description: 'Optional internal price nickname.',
        },
        lookup_key: {
          type: 'string',
          description: 'Optional lookup key for the created price.',
        },
        quantity: {
          type: 'integer',
          minimum: 1,
          maximum: 999999,
          description: 'Line item quantity. Default 1.',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Optional metadata applied to product, price, and payment link. Values are converted to strings.',
        },
        reference_key: {
          type: 'string',
          description: 'Optional RUDI/client reference stored in metadata as rudi_reference_key.',
        },
        after_completion_url: {
          type: 'string',
          description: 'Optional HTTPS URL to redirect to after successful payment.',
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional base Stripe idempotency key. The tool appends step suffixes.',
        },
        confirm_create: {
          type: 'boolean',
          description: 'Must be true to perform Stripe writes. Omit for dry-run.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Set true to force dry-run even when confirm_create is true.',
        },
      },
      required: ['product_name', 'unit_amount'],
    },
  },
];

function redactSecrets(value) {
  return String(value)
    .replace(/sk_(live|test)_[A-Za-z0-9_]+/g, 'sk_$1_[redacted]')
    .replace(/rk_(live|test)_[A-Za-z0-9_]+/g, 'rk_$1_[redacted]');
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function asText(data) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function asError(message) {
  return {
    content: [
      {
        type: 'text',
        text: `Error: ${redactSecrets(message)}`,
      },
    ],
    isError: true,
  };
}

function requireApiKey() {
  if (!API_KEY) {
    throw new Error('STRIPE_API_KEY is not configured in RUDI secrets.');
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function readString(args, name, options = {}) {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    if (options.required) throw new Error(`${name} is required.`);
    return options.defaultValue;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }
  const trimmed = options.trim === false ? value : value.trim();
  if (options.required && !trimmed) {
    throw new Error(`${name} is required.`);
  }
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new Error(`${name} must be ${options.maxLength} characters or fewer.`);
  }
  return trimmed;
}

function readBoolean(args, name, defaultValue) {
  const value = args[name];
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean.`);
  }
  return value;
}

function readInteger(args, name, options = {}) {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    if (options.required) throw new Error(`${name} is required.`);
    return options.defaultValue;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${name} must be at most ${options.max}.`);
  }
  return value;
}

function readCurrency(args, name = 'currency') {
  const value = readString(args, name, { defaultValue: 'usd' }).toLowerCase();
  if (!/^[a-z]{3}$/.test(value)) {
    throw new Error(`${name} must be a three-letter currency code.`);
  }
  return value;
}

function readHttpsUrl(args, name) {
  const value = readString(args, name);
  if (!value) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS.`);
  }
  return parsed.toString();
}

function readMetadata(args) {
  const metadata = args.metadata;
  if (metadata === undefined || metadata === null) return undefined;
  requireObject(metadata, 'metadata');
  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[A-Za-z0-9_.:-]{1,40}$/.test(key)) {
      throw new Error(`metadata key "${key}" must be 1-40 chars and use letters, numbers, _, ., :, or -.`);
    }
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      throw new Error(`metadata value for "${key}" must be a scalar.`);
    }
    normalized[key] = String(value).slice(0, 500);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function addReferenceMetadata(metadata, referenceKey) {
  if (!referenceKey) return metadata;
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(referenceKey)) {
    throw new Error('reference_key must be 1-120 chars and use letters, numbers, _, ., :, or -.');
  }
  return {
    ...(metadata || {}),
    rudi_reference_key: referenceKey,
  };
}

function appendParams(params, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendParams(params, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendParams(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  params.append(key, String(value));
}

function toStripeParams(data) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data || {})) {
    appendParams(params, key, value);
  }
  return params;
}

async function stripeRequest(path, options = {}) {
  requireApiKey();

  const method = options.method || 'GET';
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
  };
  const request = { method, headers };
  const url = new URL(`${STRIPE_API_BASE}${path}`);

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  if (method === 'GET') {
    const params = toStripeParams(options.params);
    for (const [key, value] of params.entries()) {
      url.searchParams.append(key, value);
    }
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    request.body = toStripeParams(options.params).toString();
  }

  const response = await fetch(url, request);
  const bodyText = await response.text();
  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const stripeMessage = body?.error?.message || body?.error?.code || bodyText || response.statusText;
    throw new Error(`Stripe API ${response.status}: ${stripeMessage}`);
  }

  return body || {};
}

function wantsDryRun(args) {
  return readBoolean(args, 'dry_run', false) || readBoolean(args, 'confirm_create', false) !== true;
}

function dryRunPayload(action, params) {
  return {
    dry_run: true,
    action,
    would_send: params,
    required_confirmation: 'Set confirm_create to true to perform this Stripe write.',
  };
}

function summarizeProduct(product) {
  return {
    id: product.id,
    object: product.object,
    name: product.name,
    description: product.description || null,
    active: product.active,
    livemode: product.livemode,
    metadata: product.metadata || {},
    dashboard_url: product.id ? `https://dashboard.stripe.com/products/${product.id}` : undefined,
  };
}

function summarizePrice(price) {
  return {
    id: price.id,
    object: price.object,
    product: price.product,
    active: price.active,
    currency: price.currency,
    unit_amount: price.unit_amount,
    nickname: price.nickname || null,
    lookup_key: price.lookup_key || null,
    livemode: price.livemode,
    metadata: price.metadata || {},
  };
}

function summarizePaymentLink(paymentLink) {
  return {
    id: paymentLink.id,
    object: paymentLink.object,
    active: paymentLink.active,
    url: paymentLink.url,
    livemode: paymentLink.livemode,
    metadata: paymentLink.metadata || {},
  };
}

function idempotencyKey(args, suffix) {
  const base = readString(args, 'idempotency_key', { maxLength: 180 });
  return base ? `${base}:${suffix}` : undefined;
}

function configStatus() {
  const configured = Boolean(API_KEY);
  let key_mode = 'missing';
  if (API_KEY.startsWith('sk_live_') || API_KEY.startsWith('rk_live_')) key_mode = 'live';
  if (API_KEY.startsWith('sk_test_') || API_KEY.startsWith('rk_test_')) key_mode = 'test';
  if (configured && key_mode === 'missing') key_mode = 'unknown';

  return {
    configured,
    key_mode,
    writes_are_guarded: true,
    write_confirmation_field: 'confirm_create',
  };
}

async function listProducts(rawArgs) {
  const args = requireObject(rawArgs || {}, 'arguments');
  const params = {
    limit: readInteger(args, 'limit', { defaultValue: 10, min: 1, max: 100 }),
  };
  if (args.active !== undefined) {
    params.active = readBoolean(args, 'active', undefined);
  }

  const result = await stripeRequest('/products', { params });
  return {
    has_more: result.has_more,
    products: (result.data || []).map(summarizeProduct),
  };
}

async function listPrices(rawArgs) {
  const args = requireObject(rawArgs || {}, 'arguments');
  const params = {
    limit: readInteger(args, 'limit', { defaultValue: 10, min: 1, max: 100 }),
  };
  const product = readString(args, 'product');
  const currency = args.currency === undefined ? undefined : readCurrency(args, 'currency');
  if (product) params.product = product;
  if (currency) params.currency = currency;
  if (args.active !== undefined) params.active = readBoolean(args, 'active', undefined);

  const result = await stripeRequest('/prices', { params });
  return {
    has_more: result.has_more,
    prices: (result.data || []).map(summarizePrice),
  };
}

async function createProduct(rawArgs) {
  const args = requireObject(rawArgs || {}, 'arguments');
  const params = {
    name: readString(args, 'name', { required: true, maxLength: 250 }),
  };
  const description = readString(args, 'description', { maxLength: 4000 });
  const statementDescriptor = readString(args, 'statement_descriptor', { maxLength: 22 });
  const metadata = readMetadata(args);
  if (description) params.description = description;
  if (statementDescriptor) params.statement_descriptor = statementDescriptor;
  if (metadata) params.metadata = metadata;

  if (wantsDryRun(args)) return dryRunPayload('create_product', params);

  const product = await stripeRequest('/products', {
    method: 'POST',
    params,
    idempotencyKey: idempotencyKey(args, 'product'),
  });
  return {
    created: true,
    product: summarizeProduct(product),
  };
}

async function createPrice(rawArgs) {
  const args = requireObject(rawArgs || {}, 'arguments');
  const params = {
    product: readString(args, 'product', { required: true }),
    unit_amount: readInteger(args, 'unit_amount', { required: true, min: 1 }),
    currency: readCurrency(args),
  };
  const nickname = readString(args, 'nickname', { maxLength: 250 });
  const lookupKey = readString(args, 'lookup_key', { maxLength: 200 });
  const metadata = readMetadata(args);
  if (nickname) params.nickname = nickname;
  if (lookupKey) params.lookup_key = lookupKey;
  if (metadata) params.metadata = metadata;

  if (wantsDryRun(args)) return dryRunPayload('create_price', params);

  const price = await stripeRequest('/prices', {
    method: 'POST',
    params,
    idempotencyKey: idempotencyKey(args, 'price'),
  });
  return {
    created: true,
    price: summarizePrice(price),
  };
}

async function createPaymentLink(rawArgs) {
  const args = requireObject(rawArgs || {}, 'arguments');
  const afterCompletionUrl = readHttpsUrl(args, 'after_completion_url');
  const metadata = readMetadata(args);
  const params = {
    line_items: [
      {
        price: readString(args, 'price', { required: true }),
        quantity: readInteger(args, 'quantity', { defaultValue: 1, min: 1, max: 999999 }),
      },
    ],
  };
  if (metadata) params.metadata = metadata;
  if (afterCompletionUrl) {
    params.after_completion = {
      type: 'redirect',
      redirect: { url: afterCompletionUrl },
    };
  }

  if (wantsDryRun(args)) return dryRunPayload('create_payment_link', params);

  const paymentLink = await stripeRequest('/payment_links', {
    method: 'POST',
    params,
    idempotencyKey: idempotencyKey(args, 'payment_link'),
  });
  return {
    created: true,
    payment_link: summarizePaymentLink(paymentLink),
  };
}

async function createOneTimePaymentLink(rawArgs) {
  const args = requireObject(rawArgs || {}, 'arguments');
  const baseMetadata = addReferenceMetadata(readMetadata(args), readString(args, 'reference_key', { maxLength: 120 }));
  const currency = readCurrency(args);
  const quantity = readInteger(args, 'quantity', { defaultValue: 1, min: 1, max: 999999 });
  const afterCompletionUrl = readHttpsUrl(args, 'after_completion_url');

  const productParams = {
    name: readString(args, 'product_name', { required: true, maxLength: 250 }),
  };
  const description = readString(args, 'description', { maxLength: 4000 });
  if (description) productParams.description = description;
  if (baseMetadata) productParams.metadata = baseMetadata;

  const priceParams = {
    currency,
    unit_amount: readInteger(args, 'unit_amount', { required: true, min: 1 }),
  };
  const priceNickname = readString(args, 'price_nickname', { maxLength: 250 });
  const lookupKey = readString(args, 'lookup_key', { maxLength: 200 });
  if (priceNickname) priceParams.nickname = priceNickname;
  if (lookupKey) priceParams.lookup_key = lookupKey;
  if (baseMetadata) priceParams.metadata = baseMetadata;

  const linkParamsWithoutPrice = {
    line_items: [
      {
        quantity,
      },
    ],
  };
  if (baseMetadata) linkParamsWithoutPrice.metadata = baseMetadata;
  if (afterCompletionUrl) {
    linkParamsWithoutPrice.after_completion = {
      type: 'redirect',
      redirect: { url: afterCompletionUrl },
    };
  }

  if (wantsDryRun(args)) {
    return dryRunPayload('create_one_time_payment_link', {
      product: productParams,
      price: priceParams,
      payment_link: {
        ...linkParamsWithoutPrice,
        line_items: [
          {
            price: '<created_price_id>',
            quantity,
          },
        ],
      },
    });
  }

  const product = await stripeRequest('/products', {
    method: 'POST',
    params: productParams,
    idempotencyKey: idempotencyKey(args, 'product'),
  });

  const price = await stripeRequest('/prices', {
    method: 'POST',
    params: {
      ...priceParams,
      product: product.id,
    },
    idempotencyKey: idempotencyKey(args, 'price'),
  });

  const paymentLink = await stripeRequest('/payment_links', {
    method: 'POST',
    params: {
      ...linkParamsWithoutPrice,
      line_items: [
        {
          price: price.id,
          quantity,
        },
      ],
    },
    idempotencyKey: idempotencyKey(args, 'payment_link'),
  });

  return {
    created: true,
    product: summarizeProduct(product),
    price: summarizePrice(price),
    payment_link: summarizePaymentLink(paymentLink),
  };
}

async function callTool(name, args) {
  switch (name) {
    case 'stripe_config_status':
      return configStatus();
    case 'stripe_list_products':
      return listProducts(args);
    case 'stripe_list_prices':
      return listPrices(args);
    case 'stripe_create_product':
      return createProduct(args);
    case 'stripe_create_price':
      return createPrice(args);
    case 'stripe_create_payment_link':
      return createPaymentLink(args);
    case 'stripe_create_one_time_payment_link':
      return createOneTimePaymentLink(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRequest(message) {
  if (!message || typeof message !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid request.' },
    };
  }

  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    return null;
  }

  try {
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'stripe', version: '1.1.0' },
        },
      };
    }

    if (message.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: TOOLS },
      };
    }

    if (message.method === 'tools/call') {
      const params = requireObject(message.params || {}, 'params');
      const name = readString(params, 'name', { required: true });
      const args = params.arguments || {};
      try {
        const result = await callTool(name, args);
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: asText(result),
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: asError(error instanceof Error ? error.message : String(error)),
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unknown method: ${message.method}` },
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: message.id ?? null,
      error: {
        code: -32000,
        message: redactSecrets(error instanceof Error ? error.message : String(error)),
      },
    };
  }
}

let stdinBuffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  let newlineIndex = stdinBuffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = stdinBuffer.slice(0, newlineIndex).replace(/\r$/, '');
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    newlineIndex = stdinBuffer.indexOf('\n');

    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      writeMessage({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: redactSecrets(error instanceof Error ? error.message : String(error)),
        },
      });
      continue;
    }

    handleRequest(message)
      .then((response) => {
        if (response) writeMessage(response);
      })
      .catch((error) => {
        writeMessage({
          jsonrpc: '2.0',
          id: message?.id ?? null,
          error: {
            code: -32000,
            message: redactSecrets(error instanceof Error ? error.message : String(error)),
          },
        });
      });
  }
});

process.on('uncaughtException', (error) => {
  process.stderr.write(`${redactSecrets(error instanceof Error ? error.stack || error.message : String(error))}\n`);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${redactSecrets(reason instanceof Error ? reason.stack || reason.message : String(reason))}\n`);
});
