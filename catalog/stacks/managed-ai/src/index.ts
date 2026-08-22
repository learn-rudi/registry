#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { createManagedAiClient, ManagedAiApiError, type ManagedAiClient } from './client.js'
import {
  asRecord,
  MAX_PUBLICATION_CONTENT_CHARACTERS,
  parseCandidateListInput,
  parseCandidateReviewInput,
  parseClientContextInput,
  parseInteractionListInput,
  parseObservationListInput,
  parseOrganizationContextInput,
  parseProjectionBundleInput,
  parsePublicationPreparationInput,
  ToolInputError,
} from './contracts.js'
import {
  assertNoSensitiveEcho,
  parseCandidatePageResponse,
  parseClientContextResponse,
  parseDecisionResponse,
  parseInteractionPageResponse,
  parseObservationPageResponse,
  parseOrganizationContextResponse,
  parseProjectionBundleResponse,
  parseProjectionPreparationResponse,
  ResponseContractError,
} from './responses.js'

export interface ManagedAiConfigStatus {
  api_url_configured: boolean
  bearer_token_configured: boolean
  tenant_id_configured: boolean
  transport: 'authenticated_https_api'
  raw_sql_enabled: false
}

export interface CreateServerOptions {
  client?: ManagedAiClient
  configStatus?: ManagedAiConfigStatus
  sensitiveValues?: readonly string[]
}

const UUID_SCHEMA = { type: 'string', format: 'uuid' } as const
const PAGE_PROPERTIES = {
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  cursor: { ...UUID_SCHEMA, description: 'Stable UUID cursor returned by the API.' },
} as const

export const TOOL_DEFINITIONS = [
  {
    name: 'managed_ai_config_status',
    description: 'Check Managed AI API client configuration without exposing the bearer token, tenant identifier, or API endpoint.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'managed_ai_get_client_context',
    description: 'Read bounded context for one client in the stack-configured tenant through the authenticated Managed AI API.',
    inputSchema: {
      type: 'object',
      properties: { client_id: UUID_SCHEMA, ...PAGE_PROPERTIES },
      required: ['client_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'managed_ai_get_organization_context',
    description: 'Read bounded context for one organization in the stack-configured tenant through the authenticated Managed AI API.',
    inputSchema: {
      type: 'object',
      properties: { organization_id: UUID_SCHEMA, ...PAGE_PROPERTIES },
      required: ['organization_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'managed_ai_list_interactions',
    description: 'List bounded, cursor-paginated business interactions in the stack-configured tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PAGE_PROPERTIES,
        client_id: UUID_SCHEMA,
        organization_id: UUID_SCHEMA,
        kind: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'managed_ai_list_observations',
    description: 'List bounded normalized observations for review in the stack-configured tenant; raw provider artifacts are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PAGE_PROPERTIES,
        kind: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'managed_ai_list_candidates',
    description: 'List bounded review candidates (API proposals) without promoting people, organizations, clients, or relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PAGE_PROPERTIES,
        client_id: UUID_SCHEMA,
        state: { type: 'string', minLength: 1, maxLength: 128 },
        kind: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'managed_ai_review_candidate',
    description: 'After explicit human approval of this exact candidate version and digest, record an approve or reject decision through the Managed AI API. This never performs fuzzy matching or direct record promotion.',
    inputSchema: {
      type: 'object',
      properties: {
        candidate_id: UUID_SCHEMA,
        expected_version: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
        proposal_digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
        reason: { type: 'string', minLength: 1, maxLength: 2_000 },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
        confirm_decision: {
          type: 'boolean',
          description: 'Must be true only after a human approves this exact decision payload.',
        },
      },
      required: [
        'candidate_id', 'expected_version', 'proposal_digest', 'decision', 'reason',
        'idempotency_key', 'confirm_decision',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'managed_ai_prepare_projection',
    description: 'Prepare an approval-backed, no-write client workspace projection bundle. This records API state only; it cannot write files, apply patches, commit, or push Git history.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: UUID_SCHEMA,
        approval_ids: {
          type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: UUID_SCHEMA,
        },
        source_cutoff: { type: 'string', format: 'date-time' },
        git_remote: { type: 'string', minLength: 1, maxLength: 1_024 },
        base_revision: { type: 'string', pattern: '^[0-9a-f]{40,64}$' },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 256 },
        confirm_prepare: {
          type: 'boolean',
          description: 'Must be true only after a human authorizes preparation for the exact approval IDs and base revision.',
        },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              target_path: {
                type: 'string',
                enum: [
                  'workspace/contacts.md',
                  'workspace/context.md',
                  'workspace/interaction-log.md',
                  'workspace/next-steps.md',
                  'workspace/decisions.md',
                ],
              },
              expected_file_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
              content: {
                type: 'string',
                maxLength: MAX_PUBLICATION_CONTENT_CHARACTERS,
                description: 'At most 5,000 Unicode characters and 20,000 UTF-8 bytes.',
              },
            },
            required: ['target_path', 'expected_file_sha256', 'content'],
            additionalProperties: false,
          },
        },
      },
      required: [
        'client_id', 'approval_ids', 'source_cutoff', 'git_remote', 'base_revision',
        'idempotency_key', 'confirm_prepare', 'items',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'managed_ai_get_projection_bundle',
    description: 'Read one prepared projection bundle and its approval evidence through the authenticated API without applying it.',
    inputSchema: {
      type: 'object',
      properties: { projection_run_id: UUID_SCHEMA },
      required: ['projection_run_id'],
      additionalProperties: false,
    },
  },
] as const

function currentConfigStatus(): ManagedAiConfigStatus {
  return {
    api_url_configured: Boolean(process.env.RUDI_MANAGED_AI_API_URL),
    bearer_token_configured: Boolean(process.env.RUDI_MANAGED_AI_API_TOKEN),
    tenant_id_configured: Boolean(process.env.RUDI_MANAGED_AI_TENANT_ID),
    transport: 'authenticated_https_api',
    raw_sql_enabled: false,
  }
}

function configuredClient(): ManagedAiClient {
  const apiUrl = process.env.RUDI_MANAGED_AI_API_URL
  const bearerToken = process.env.RUDI_MANAGED_AI_API_TOKEN
  const tenantId = process.env.RUDI_MANAGED_AI_TENANT_ID
  if (!apiUrl || !bearerToken || !tenantId) {
    throw new Error('Managed AI API URL, bearer token, and tenant ID are required.')
  }
  return createManagedAiClient({ apiUrl, bearerToken, tenantId })
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
  } else if (error instanceof ManagedAiApiError) {
    body = {
      code: error.code,
      message: 'The Managed AI API could not complete the request.',
      retryable: error.retryable,
    }
  } else if (error instanceof ResponseContractError) {
    body = {
      code: 'INVALID_API_RESPONSE',
      message: 'The Managed AI API returned an invalid response.',
      retryable: true,
    }
  } else {
    body = {
      code: 'CONFIGURATION_OR_OPERATION_FAILED',
      message: 'The Managed AI client is unavailable or rejected the request.',
      retryable: false,
    }
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: body }, null, 2) }],
    isError: true,
  }
}

function requireConfirmation(input: Record<string, unknown>, field: string): void {
  if (input[field] !== true) {
    throw new ToolInputError('INVALID_INPUT', `${field} must be true after exact human approval.`)
  }
}

export function createServer(options: CreateServerOptions = {}): Server {
  let defaultClient: ManagedAiClient | undefined
  const getClient = () => options.client ?? (defaultClient ??= configuredClient())
  const sensitiveValues = options.sensitiveValues ??
    (process.env.RUDI_MANAGED_AI_API_TOKEN ? [process.env.RUDI_MANAGED_AI_API_TOKEN] : [])
  const guardedSuccessResponse = (
    value: unknown,
    parseResponse: (response: unknown, bearerToken: string) => unknown,
  ) => {
    const validated = parseResponse(value, '')
    assertNoSensitiveEcho(validated, sensitiveValues)
    return successResponse(validated)
  }
  const server = new Server(
    { name: 'managed-ai', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((tool) => ({ ...tool })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const input = asRecord(request.params.arguments)
      switch (request.params.name) {
        case 'managed_ai_config_status':
          if (Object.keys(input).length > 0) throw new ToolInputError('INVALID_INPUT', 'Configuration status accepts no fields.')
          return successResponse(options.configStatus ?? currentConfigStatus())
        case 'managed_ai_get_client_context':
          return guardedSuccessResponse(
            await getClient().getClientContext(parseClientContextInput(input)),
            parseClientContextResponse,
          )
        case 'managed_ai_get_organization_context':
          return guardedSuccessResponse(
            await getClient().getOrganizationContext(parseOrganizationContextInput(input)),
            parseOrganizationContextResponse,
          )
        case 'managed_ai_list_interactions':
          return guardedSuccessResponse(
            await getClient().listInteractions(parseInteractionListInput(input)),
            parseInteractionPageResponse,
          )
        case 'managed_ai_list_observations':
          return guardedSuccessResponse(
            await getClient().listObservations(parseObservationListInput(input)),
            parseObservationPageResponse,
          )
        case 'managed_ai_list_candidates':
          return guardedSuccessResponse(
            await getClient().listCandidates(parseCandidateListInput(input)),
            parseCandidatePageResponse,
          )
        case 'managed_ai_review_candidate': {
          requireConfirmation(input, 'confirm_decision')
          const { confirm_decision: _confirmation, ...candidateInput } = input
          return guardedSuccessResponse(
            await getClient().reviewCandidate(parseCandidateReviewInput(candidateInput)),
            parseDecisionResponse,
          )
        }
        case 'managed_ai_prepare_projection': {
          requireConfirmation(input, 'confirm_prepare')
          const { confirm_prepare: _confirmation, ...projectionInput } = input
          return guardedSuccessResponse(
            await getClient().prepareProjection(parsePublicationPreparationInput(projectionInput)),
            parseProjectionPreparationResponse,
          )
        }
        case 'managed_ai_get_projection_bundle':
          return guardedSuccessResponse(
            await getClient().getProjectionBundle(parseProjectionBundleInput(input)),
            parseProjectionBundleResponse,
          )
        default:
          throw new ToolInputError('UNKNOWN_TOOL', 'Unknown Managed AI tool.')
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
    console.error(error instanceof Error ? error.message : 'Managed AI stack failed to start.')
    process.exit(1)
  })
}
