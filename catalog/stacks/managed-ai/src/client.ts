import { randomUUID } from 'node:crypto'

import {
  assertUuid,
  buildPublicationBundle,
  parseCandidateListInput,
  parseCandidateReviewInput,
  parseClientContextInput,
  parseInteractionListInput,
  parseObservationListInput,
  parseOrganizationContextInput,
  parseProjectionBundleInput,
  parsePublicationPreparationInput,
  type CandidateListInput,
  type CandidateReviewInput,
  type ContextInput,
  type InteractionListInput,
  type JsonValue,
  type ObservationListInput,
  type ProjectionBundleInput,
  type PublicationPreparationInput,
} from './contracts.js'
import {
  parseCandidatePageResponse,
  parseClientContextResponse,
  parseDecisionResponse,
  parseInteractionPageResponse,
  parseObservationPageResponse,
  parseOrganizationContextResponse,
  parseProjectionBundleResponse,
  parseProjectionPreparationResponse,
} from './responses.js'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 1_048_576

export class ManagedAiApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(`Managed AI API request failed (${code}).`)
    this.name = 'ManagedAiApiError'
  }
}

export interface ManagedAiClientOptions {
  apiUrl: string
  tenantId: string
  bearerToken: string
  fetch?: typeof fetch
  timeoutMs?: number
  maximumResponseBytes?: number
}

export interface ManagedAiClient {
  getClientContext(input: Required<Pick<ContextInput, 'clientId'>> & Omit<ContextInput, 'clientId'>): Promise<JsonValue>
  getOrganizationContext(input: Required<Pick<ContextInput, 'organizationId'>> & Omit<ContextInput, 'organizationId'>): Promise<JsonValue>
  listInteractions(input: InteractionListInput): Promise<JsonValue>
  listObservations(input: ObservationListInput): Promise<JsonValue>
  listCandidates(input: CandidateListInput): Promise<JsonValue>
  reviewCandidate(input: CandidateReviewInput): Promise<JsonValue>
  prepareProjection(input: PublicationPreparationInput): Promise<JsonValue>
  getProjectionBundle(input: ProjectionBundleInput): Promise<JsonValue>
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())
}

function parseApiOrigin(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch {
    throw new Error('RUDI_MANAGED_AI_API_URL must be a valid URL.')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('RUDI_MANAGED_AI_API_URL must use HTTPS except on loopback.')
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('RUDI_MANAGED_AI_API_URL must be an origin without credentials, path, query, or fragment.')
  }
  return new URL(url.origin)
}

function positiveBoundedInteger(
  value: number | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const selected = value ?? defaultValue
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return selected
}

function validateBearerToken(value: string): string {
  if (typeof value !== 'string' || value.length < 16 || value.length > 8_192 || /[\0\r\n]/.test(value)) {
    throw new Error('RUDI_MANAGED_AI_API_TOKEN is missing or invalid.')
  }
  return value
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > maximumBytes) {
      throw new ManagedAiApiError('INVALID_API_RESPONSE', 502, true)
    }
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel()
        throw new ManagedAiApiError('INVALID_API_RESPONSE', 502, true)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function assertBoundedJson(value: unknown): asserts value is JsonValue {
  let nodes = 0
  const visit = (entry: unknown, depth: number): void => {
    nodes += 1
    if (nodes > 20_000 || depth > 20) throw new Error('invalid JSON shape')
    if (entry === null || typeof entry === 'boolean') return
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new Error('invalid JSON number')
      return
    }
    if (typeof entry === 'string') {
      if (Buffer.byteLength(entry, 'utf8') > 262_144) throw new Error('invalid JSON string')
      return
    }
    if (Array.isArray(entry)) {
      if (entry.length > 10_000) throw new Error('invalid JSON array')
      for (const child of entry) visit(child, depth + 1)
      return
    }
    if (typeof entry === 'object') {
      const pairs = Object.entries(entry)
      if (pairs.length > 2_000) throw new Error('invalid JSON object')
      for (const [key, child] of pairs) {
        if (
          key.length > 512 ||
          ['__proto__', 'prototype', 'constructor'].includes(key)
        ) throw new Error('invalid JSON key')
        visit(child, depth + 1)
      }
      return
    }
    throw new Error('invalid JSON value')
  }
  visit(value, 0)
}

function queryString(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const serialized = params.toString()
  return serialized.length === 0 ? '' : `?${serialized}`
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export function createManagedAiClient(options: ManagedAiClientOptions): ManagedAiClient {
  const apiOrigin = parseApiOrigin(options.apiUrl)
  const tenantId = assertUuid(options.tenantId, 'RUDI_MANAGED_AI_TENANT_ID')
  const bearerToken = validateBearerToken(options.bearerToken)
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = positiveBoundedInteger(
    options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 60_000, 'timeoutMs',
  )
  const maximumResponseBytes = positiveBoundedInteger(
    options.maximumResponseBytes,
    DEFAULT_MAXIMUM_RESPONSE_BYTES,
    1,
    4_194_304,
    'maximumResponseBytes',
  )

  async function request(
    path: string,
    parseResponse: (value: unknown, token: string) => JsonValue,
    init: RequestInit = {},
  ): Promise<JsonValue> {
    if (!path.startsWith('/v1/tenants/')) {
      throw new ManagedAiApiError('INVALID_CLIENT_ROUTE', 0, false)
    }
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    headers.set('authorization', `Bearer ${bearerToken}`)
    headers.set('x-correlation-id', randomUUID())
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      let response: Response
      try {
        response = await fetchImpl(new URL(path, apiOrigin), {
          ...init,
          headers,
          redirect: 'error',
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) throw new ManagedAiApiError('TIMEOUT', 0, true)
        if (error instanceof ManagedAiApiError) throw error
        throw new ManagedAiApiError('NETWORK_ERROR', 0, true)
      }

      if (!response.ok) {
        controller.abort()
        if (response.body !== null) void response.body.cancel().catch(() => undefined)
        throw new ManagedAiApiError(`HTTP_${response.status}`, response.status, retryableStatus(response.status))
      }

      let text: string
      try {
        text = await readBoundedText(response, maximumResponseBytes)
      } catch (error) {
        if (controller.signal.aborted) throw new ManagedAiApiError('TIMEOUT', 0, true)
        if (error instanceof ManagedAiApiError) throw error
        throw new ManagedAiApiError('NETWORK_ERROR', 0, true)
      }
      const contentType = response.headers.get('content-type')
      if (contentType !== null && !contentType.toLowerCase().startsWith('application/json')) {
        throw new ManagedAiApiError('INVALID_API_RESPONSE', 502, true)
      }
      let body: unknown
      try {
        body = JSON.parse(text) as unknown
        assertBoundedJson(body)
      } catch {
        throw new ManagedAiApiError('INVALID_API_RESPONSE', 502, true)
      }
      try {
        return parseResponse(body, bearerToken)
      } catch {
        throw new ManagedAiApiError('INVALID_API_RESPONSE', 502, true)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    getClientContext(rawInput) {
      const input = parseClientContextInput({
        client_id: rawInput.clientId,
        limit: rawInput.limit,
        cursor: rawInput.cursor,
      })
      return request(
        `/v1/tenants/${tenantId}/clients/${input.clientId}/context${queryString({
          limit: input.limit,
          cursor: input.cursor,
        })}`,
        parseClientContextResponse,
      )
    },

    getOrganizationContext(rawInput) {
      const input = parseOrganizationContextInput({
        organization_id: rawInput.organizationId,
        limit: rawInput.limit,
        cursor: rawInput.cursor,
      })
      return request(
        `/v1/tenants/${tenantId}/organizations/${input.organizationId}/context${queryString({
          limit: input.limit,
          cursor: input.cursor,
        })}`,
        parseOrganizationContextResponse,
      )
    },

    listInteractions(rawInput) {
      const input = parseInteractionListInput({
        limit: rawInput.limit,
        cursor: rawInput.cursor,
        client_id: rawInput.clientId,
        organization_id: rawInput.organizationId,
        kind: rawInput.kind,
      })
      return request(`/v1/tenants/${tenantId}/interactions${queryString({
        limit: input.limit,
        cursor: input.cursor,
        clientId: input.clientId,
        organizationId: input.organizationId,
        kind: input.kind,
      })}`, parseInteractionPageResponse)
    },

    listObservations(rawInput) {
      const input = parseObservationListInput({
        limit: rawInput.limit,
        cursor: rawInput.cursor,
        kind: rawInput.kind,
      })
      return request(`/v1/tenants/${tenantId}/observations${queryString({
        limit: input.limit,
        cursor: input.cursor,
        kind: input.kind,
      })}`, parseObservationPageResponse)
    },

    listCandidates(rawInput) {
      const input = parseCandidateListInput({
        limit: rawInput.limit,
        cursor: rawInput.cursor,
        client_id: rawInput.clientId,
        state: rawInput.state,
        kind: rawInput.kind,
      })
      return request(`/v1/tenants/${tenantId}/proposals${queryString({
        limit: input.limit,
        cursor: input.cursor,
        clientId: input.clientId,
        state: input.state,
        kind: input.kind,
      })}`, parseCandidatePageResponse)
    },

    reviewCandidate(rawInput) {
      const input = parseCandidateReviewInput({
        candidate_id: rawInput.candidateId,
        expected_version: rawInput.expectedVersion,
        proposal_digest: rawInput.proposalDigest,
        decision: rawInput.decision,
        reason: rawInput.reason,
        idempotency_key: rawInput.idempotencyKey,
      })
      return request(
        `/v1/tenants/${tenantId}/proposals/${input.candidateId}/decisions`,
        parseDecisionResponse,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': input.idempotencyKey,
          },
          body: JSON.stringify({
            expectedVersion: input.expectedVersion,
            proposalDigest: input.proposalDigest,
            decision: input.decision,
            reason: input.reason,
          }),
        },
      )
    },

    prepareProjection(rawInput) {
      const input = parsePublicationPreparationInput({
        client_id: rawInput.clientId,
        approval_ids: rawInput.approvalIds,
        source_cutoff: rawInput.sourceCutoff,
        git_remote: rawInput.gitRemote,
        base_revision: rawInput.baseRevision,
        idempotency_key: rawInput.idempotencyKey,
        items: rawInput.items,
      })
      const bundle = buildPublicationBundle(tenantId, input)
      return request(
        `/v1/tenants/${tenantId}/clients/${input.clientId}/publication-runs`,
        parseProjectionPreparationResponse,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': input.idempotencyKey,
          },
          body: JSON.stringify(bundle),
        },
      )
    },

    getProjectionBundle(rawInput) {
      const input = parseProjectionBundleInput({ projection_run_id: rawInput.projectionRunId })
      return request(
        `/v1/tenants/${tenantId}/publication-runs/${input.projectionRunId}/bundle`,
        parseProjectionBundleResponse,
      )
    },
  }
}
