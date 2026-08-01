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
import { createShareWorkflow } from './workflow.js'

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
  const apiUrl = process.env.RUDI_SHARE_API_URL
  const publisherToken = process.env.RUDI_SHARE_TOKEN
  if (!apiUrl) throw new Error('RUDI_SHARE_API_URL is required.')
  if (!publisherToken) throw new Error('RUDI_SHARE_TOKEN is required.')
  return createShareWorkflow({
    client: createRudiShareClient({ apiUrl, publisherToken }),
  })
}

export function createServer(options: CreateServerOptions = {}): Server {
  const workflow = options.workflow ?? configuredWorkflow()
  const preflight = options.preflight ?? preflightProject
  const server = new Server(
    { name: 'rudi-share', version: '0.1.0' },
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
          'After explicit user approval, create an Anyone-with-the-link share. With artifact_path, package and upload it directly. Without artifact_path, return a one-time signed upload target for the caller shell.',
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
        description: 'Get the owner-visible status and public URL for a RUDI Share.',
        inputSchema: {
          type: 'object',
          properties: { share_id: { type: 'string', maxLength: 128 } },
          required: ['share_id'],
          additionalProperties: false,
        },
      },
      {
        name: 'rudi_share_unpublish',
        description:
          'After explicit user approval, immediately revoke a RUDI Share public URL.',
        inputSchema: {
          type: 'object',
          properties: {
            share_id: { type: 'string', maxLength: 128 },
            idempotency_key: { type: 'string', maxLength: 128 },
            confirm_unpublish: {
              type: 'boolean',
              description: 'Must be true only after the user approves immediate revocation.',
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
              artifactPath: optionalString(input, 'artifact_path'),
            })
          )
        case 'rudi_share_get':
          return successResponse(
            await workflow.get(requiredString(input, 'share_id'))
          )
        case 'rudi_share_unpublish':
          return successResponse(
            await workflow.unpublish({
              shareId: requiredString(input, 'share_id'),
              idempotencyKey: requiredString(input, 'idempotency_key'),
              confirmUnpublish: requiredBoolean(input, 'confirm_unpublish'),
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
