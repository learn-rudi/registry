#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { ArtifactPackagingError } from './artifact.js'
import { createRudiShareClient, RudiShareApiError } from './client.js'
import { preflightProject } from './core.js'
import {
  createPrivatePreviewService,
  PrivatePreviewError,
} from './private-preview.js'
import {
  createShareWorkflow,
  ShareWorkflowError,
  type ShareAccess,
  type ShareProvider,
} from './workflow.js'

type JsonRecord = Record<string, unknown>
type ShareWorkflow = ReturnType<typeof createShareWorkflow>

export interface CreateServerOptions {
  workflow?: ShareWorkflow
  preflight?: typeof preflightProject
}

class ToolInputError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolInputError('INVALID_INPUT', 'Tool arguments must be an object.')
  }
  return value as JsonRecord
}

function requiredString(
  input: JsonRecord,
  field: string,
  maxLength = 128
): string {
  const value = input[field]
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength ||
    /[\0\r\n]/.test(value)
  ) {
    throw new ToolInputError(
      'INVALID_INPUT',
      `${field} must be a non-empty string of at most ${maxLength} characters.`
    )
  }
  return value
}

function requiredBoolean(input: JsonRecord, field: string): boolean {
  if (typeof input[field] !== 'boolean') {
    throw new ToolInputError('INVALID_INPUT', `${field} must be a boolean.`)
  }
  return input[field]
}

function optionalString(
  input: JsonRecord,
  field: string,
  maxLength = 4_096
): string | undefined {
  if (input[field] === undefined) return undefined
  return requiredString(input, field, maxLength)
}

function optionalBoolean(input: JsonRecord, field: string): boolean | undefined {
  if (input[field] === undefined) return undefined
  return requiredBoolean(input, field)
}

function optionalEnum<T extends string>(
  input: JsonRecord,
  field: string,
  values: readonly T[]
): T | undefined {
  if (input[field] === undefined) return undefined
  const value = requiredString(input, field)
  if (!values.includes(value as T)) {
    throw new ToolInputError(
      'INVALID_INPUT',
      `${field} must be one of: ${values.join(', ')}.`
    )
  }
  return value as T
}

function successResponse(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}

function errorResponse(error: unknown) {
  let body: { code: string; message: string; retryable: boolean }
  if (error instanceof ToolInputError) {
    body = { code: error.code, message: error.message, retryable: false }
  } else if (error instanceof ArtifactPackagingError) {
    body = { code: error.code, message: error.message, retryable: false }
  } else if (error instanceof RudiShareApiError) {
    body = {
      code: error.code,
      message: 'RUDI Share could not complete the request.',
      retryable: error.retryable,
    }
  } else if (error instanceof PrivatePreviewError) {
    body = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.receipt ? { details: error.receipt } : {}),
    } as typeof body
  } else if (error instanceof ShareWorkflowError) {
    body = { code: error.code, message: error.message, retryable: false }
  } else {
    body = {
      code: 'TOOL_OPERATION_FAILED',
      message: 'RUDI Share could not complete the local operation.',
      retryable: false,
    }
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: body }, null, 2),
      },
    ],
    isError: true,
  }
}

function configuredWorkflow(): ShareWorkflow {
  let publicClient: ReturnType<typeof createRudiShareClient> | undefined
  return createShareWorkflow({
    getPublicClient() {
      if (publicClient) return publicClient
      const apiUrl = process.env.RUDI_SHARE_API_URL
      const publisherToken = process.env.RUDI_SHARE_TOKEN
      if (!apiUrl || !publisherToken) {
        throw new ShareWorkflowError(
          'PUBLIC_PROVIDER_NOT_CONFIGURED',
          'Anyone-with-the-link publication requires RUDI Share cloud configuration.'
        )
      }
      publicClient = createRudiShareClient({ apiUrl, publisherToken })
      return publicClient
    },
    privatePreview: createPrivatePreviewService(),
  })
}

export function createServer(options: CreateServerOptions = {}): Server {
  const workflow = options.workflow ?? configuredWorkflow()
  const preflight = options.preflight ?? preflightProject
  const server = new Server(
    { name: 'rudi-share', version: '0.2.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'rudi_share_preflight',
        description:
          'Inspect an absolute local project path without modifying it. Detects vanilla, Vite, or React-Vite and returns the artifact path plus exact local install/build commands when required.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              description: 'Absolute path to the local project directory.',
            },
          },
          required: ['project_path'],
          additionalProperties: false,
        },
      },
      {
        name: 'rudi_share_publish',
        description:
          'After explicit approval, publish a static artifact either as an Anyone-with-the-link remote share or a tailnet-private managed preview. Tailnet-private mode requires artifact_path and hides loopback host and Serve lifecycle details.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 120 },
            idempotency_key: { type: 'string', maxLength: 128 },
            confirm_publication: {
              type: 'boolean',
              description:
                'Must be true only after the user approves creating a forwardable public URL.',
            },
            confirm_tailnet_access: {
              type: 'boolean',
              description:
                'Must be true only after the user approves exposing the selected static artifact to devices allowed by current tailnet policy.',
            },
            access: {
              type: 'string',
              enum: ['anyone_with_link', 'tailnet_private'],
              description:
                'Access mode. Omit for backward-compatible Anyone-with-the-link publication.',
            },
            provider: {
              type: 'string',
              enum: ['rudi_share_service', 'tailscale_serve'],
              description:
                'Southbound provider. Omit for the provider implied by access.',
            },
            artifact_path: {
              type: 'string',
              description:
                'Optional absolute static artifact directory for same-filesystem publication.',
            },
          },
          required: ['name', 'idempotency_key', 'confirm_publication'],
          additionalProperties: false,
        },
      },
      {
        name: 'rudi_share_get',
        description:
          'Get owner-visible provider, access, URL, health, artifact provenance, and timestamps for a public share or tailnet-private preview.',
        inputSchema: {
          type: 'object',
          properties: {
            share_id: { type: 'string', maxLength: 128 },
            access: {
              type: 'string',
              enum: ['anyone_with_link', 'tailnet_private'],
            },
            provider: {
              type: 'string',
              enum: ['rudi_share_service', 'tailscale_serve'],
            },
          },
          required: ['share_id'],
          additionalProperties: false,
        },
      },
      {
        name: 'rudi_share_unpublish',
        description:
          'After explicit user approval, immediately revoke the selected public or tailnet-private RUDI Share URL.',
        inputSchema: {
          type: 'object',
          properties: {
            share_id: { type: 'string', maxLength: 128 },
            idempotency_key: { type: 'string', maxLength: 128 },
            confirm_unpublish: {
              type: 'boolean',
              description: 'Must be true only after the user approves immediate revocation.',
            },
            access: {
              type: 'string',
              enum: ['anyone_with_link', 'tailnet_private'],
            },
            provider: {
              type: 'string',
              enum: ['rudi_share_service', 'tailscale_serve'],
            },
          },
          required: ['share_id', 'idempotency_key', 'confirm_unpublish'],
          additionalProperties: false,
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const input = asRecord(request.params.arguments)
      switch (request.params.name) {
        case 'rudi_share_preflight':
          return successResponse(
            await preflight(requiredString(input, 'project_path', 4_096))
          )
        case 'rudi_share_publish':
          return successResponse(
            await workflow.publish({
              name: requiredString(input, 'name', 120),
              idempotencyKey: requiredString(input, 'idempotency_key'),
              confirmPublication: requiredBoolean(input, 'confirm_publication'),
              confirmTailnetAccess:
                optionalBoolean(input, 'confirm_tailnet_access'),
              access: optionalEnum<ShareAccess>(input, 'access', [
                'anyone_with_link',
                'tailnet_private',
              ]),
              provider: optionalEnum<ShareProvider>(input, 'provider', [
                'rudi_share_service',
                'tailscale_serve',
              ]),
              artifactPath: optionalString(input, 'artifact_path'),
            })
          )
        case 'rudi_share_get':
          return successResponse(
            await workflow.get({
              shareId: requiredString(input, 'share_id'),
              access: optionalEnum<ShareAccess>(input, 'access', [
                'anyone_with_link',
                'tailnet_private',
              ]),
              provider: optionalEnum<ShareProvider>(input, 'provider', [
                'rudi_share_service',
                'tailscale_serve',
              ]),
            })
          )
        case 'rudi_share_unpublish':
          return successResponse(
            await workflow.unpublish({
              shareId: requiredString(input, 'share_id'),
              idempotencyKey: requiredString(input, 'idempotency_key'),
              confirmUnpublish: requiredBoolean(input, 'confirm_unpublish'),
              access: optionalEnum<ShareAccess>(input, 'access', [
                'anyone_with_link',
                'tailnet_private',
              ]),
              provider: optionalEnum<ShareProvider>(input, 'provider', [
                'rudi_share_service',
                'tailscale_serve',
              ]),
            })
          )
        default:
          throw new ToolInputError('UNKNOWN_TOOL', 'Unknown RUDI Share tool.')
      }
    } catch (error) {
      return errorResponse(error)
    }
  })

  return server
}

export async function startServer(): Promise<void> {
  const server = createServer()
  await server.connect(new StdioServerTransport())
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  startServer().catch((error) => {
    console.error(error instanceof Error ? error.message : 'RUDI Share failed to start.')
    process.exit(1)
  })
}
