import {
  APPROVED_PUBLICATION_PATHS,
  isRfc3339DateTime,
  type JsonValue,
} from './contracts.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const REVISION_PATTERN = /^[0-9a-f]{40,64}$/

const ORGANIZATION_LIFECYCLES = ['active', 'inactive', 'archived'] as const
const CLIENT_LIFECYCLES = ['disabled', 'shadow', 'active', 'retired'] as const
const TASK_STATES = ['open', 'in_progress', 'completed', 'dismissed'] as const
const INTERACTION_KINDS = ['email', 'calendar_event', 'meeting'] as const
const OBSERVATION_KINDS = ['email', 'calendar_event', 'meeting', 'transcript_metadata'] as const
const PROPOSAL_KINDS = [
  'identity_match', 'client_match', 'client_link', 'interaction', 'derived_fact', 'task', 'context_change',
] as const
const PROPOSAL_STATES = ['pending', 'approved', 'rejected', 'superseded'] as const
const PUBLICATION_STATES = ['prepared', 'approved', 'published', 'failed', 'superseded'] as const

export class ResponseContractError extends Error {
  constructor() {
    super('Managed AI API response violated its endpoint contract.')
    this.name = 'ResponseContractError'
  }
}

function invalid(): never {
  throw new ResponseContractError()
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  const record = value as Record<string, unknown>
  const actual = Object.keys(record)
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) invalid()
  return record
}

function exactArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid()
  return value
}

function boundedString(value: unknown, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /\0/.test(value)) invalid()
  return value
}

function uuid(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid()
  return value
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid()
  return value
}

function revision(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) invalid()
  return value
}

function timestamp(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null
  if (!isRfc3339DateTime(value)) invalid()
  return value
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid()
  return Number(value)
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid()
  return value
}

function enumeration<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid()
  return value as T[number]
}

function normalizedKeySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function isRawProviderKey(key: string): boolean {
  const lowered = key.toLowerCase()
  if (lowered.includes('digest') || lowered.includes('sha256')) return false
  const segments = normalizedKeySegments(key)
  return segments.some((segment) => [
    'raw', 'payload', 'mime', 'body', 'html', 'transcript', 'headers', 'authorization',
    'token', 'credential', 'credentials', 'snippet',
  ].includes(segment))
}

/** Defense in depth for both validated HTTP responses and injected MCP clients. */
export function assertNoSensitiveEcho(value: unknown, sensitiveValues: readonly string[] = []): void {
  let nodes = 0
  const secrets = sensitiveValues.filter((entry) => entry.length >= 16)
  const visit = (entry: unknown, depth: number): void => {
    nodes += 1
    if (nodes > 20_000 || depth > 20) invalid()
    if (entry === null || typeof entry === 'boolean') return
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) invalid()
      return
    }
    if (typeof entry === 'string') {
      if (Buffer.byteLength(entry, 'utf8') > 262_144 || secrets.some((secret) => entry.includes(secret))) invalid()
      return
    }
    if (Array.isArray(entry)) {
      if (entry.length > 10_000) invalid()
      for (const child of entry) visit(child, depth + 1)
      return
    }
    if (typeof entry !== 'object') invalid()
    const pairs = Object.entries(entry as Record<string, unknown>)
    if (pairs.length > 2_000) invalid()
    for (const [key, child] of pairs) {
      if (
        key.length > 512 ||
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        isRawProviderKey(key)
      ) invalid()
      visit(child, depth + 1)
    }
  }
  visit(value, 0)
}

function finish(value: unknown, sensitiveValues: readonly string[]): JsonValue {
  assertNoSensitiveEcho(value, sensitiveValues)
  return value as JsonValue
}

function contextInteraction(value: unknown): void {
  const record = exactRecord(value, ['id', 'kind', 'occurredAt', 'title'])
  uuid(record.id)
  enumeration(record.kind, INTERACTION_KINDS)
  timestamp(record.occurredAt)
  boundedString(record.title, 500, true)
}

function contextTask(value: unknown): void {
  const record = exactRecord(value, ['id', 'title', 'state', 'dueAt'])
  uuid(record.id)
  boundedString(record.title, 500)
  enumeration(record.state, TASK_STATES)
  timestamp(record.dueAt, true)
}

export function parseClientContextResponse(value: unknown, bearerToken: string): JsonValue {
  if (value === null) return finish(value, [bearerToken])
  const record = exactRecord(value, [
    'id', 'name', 'lifecycle', 'organization_id', 'organization_name', 'interactions', 'tasks',
  ])
  uuid(record.id)
  boundedString(record.name, 300)
  enumeration(record.lifecycle, CLIENT_LIFECYCLES)
  uuid(record.organization_id)
  boundedString(record.organization_name, 300)
  for (const item of exactArray(record.interactions, 100)) contextInteraction(item)
  for (const item of exactArray(record.tasks, 100)) contextTask(item)
  return finish(value, [bearerToken])
}

export function parseOrganizationContextResponse(value: unknown, bearerToken: string): JsonValue {
  if (value === null) return finish(value, [bearerToken])
  const record = exactRecord(value, ['id', 'name', 'lifecycle', 'interactions'])
  uuid(record.id)
  boundedString(record.name, 300)
  enumeration(record.lifecycle, ORGANIZATION_LIFECYCLES)
  for (const item of exactArray(record.interactions, 100)) contextInteraction(item)
  return finish(value, [bearerToken])
}

function page(value: unknown, itemValidator: (item: unknown) => void): void {
  const record = exactRecord(value, ['items', 'nextCursor'])
  for (const item of exactArray(record.items, 100)) itemValidator(item)
  uuid(record.nextCursor, true)
}

export function parseInteractionPageResponse(value: unknown, bearerToken: string): JsonValue {
  page(value, (item) => {
    const record = exactRecord(item, [
      'id', 'client_id', 'organization_id', 'engagement_id', 'interaction_kind', 'occurred_at',
      'title', 'summary', 'observation_id', 'approval_id',
    ])
    uuid(record.id)
    uuid(record.client_id, true)
    uuid(record.organization_id, true)
    uuid(record.engagement_id, true)
    enumeration(record.interaction_kind, INTERACTION_KINDS)
    timestamp(record.occurred_at)
    boundedString(record.title, 500, true)
    boundedString(record.summary, 4_000, true)
    uuid(record.observation_id)
    uuid(record.approval_id)
  })
  return finish(value, [bearerToken])
}

export function parseObservationPageResponse(value: unknown, bearerToken: string): JsonValue {
  page(value, (item) => {
    const record = exactRecord(item, [
      'id', 'source_item_id', 'observation_kind', 'schema_version', 'occurred_at', 'title',
      'payload_digest_sha256', 'created_at',
    ])
    uuid(record.id)
    uuid(record.source_item_id)
    enumeration(record.observation_kind, OBSERVATION_KINDS)
    integer(record.schema_version, 1, 2_147_483_647)
    timestamp(record.occurred_at)
    boundedString(record.title, 500, true)
    sha256(record.payload_digest_sha256)
    timestamp(record.created_at)
  })
  return finish(value, [bearerToken])
}

function evidenceObject(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { invalid() }
  if (Buffer.byteLength(serialized, 'utf8') > 32_768) invalid()
}

export function parseCandidatePageResponse(value: unknown, bearerToken: string): JsonValue {
  page(value, (item) => {
    const record = exactRecord(item, [
      'id', 'proposal_kind', 'state', 'version', 'client_id', 'source_observation_id',
      'target', 'patch_operations', 'evidence', 'patch_digest_sha256', 'created_at',
    ])
    uuid(record.id)
    enumeration(record.proposal_kind, PROPOSAL_KINDS)
    enumeration(record.state, PROPOSAL_STATES)
    integer(record.version, 1, 2_147_483_647)
    uuid(record.client_id, true)
    uuid(record.source_observation_id, true)
    evidenceObject(record.target)
    for (const operation of exactArray(record.patch_operations, 5)) evidenceObject(operation)
    evidenceObject(record.evidence)
    sha256(record.patch_digest_sha256)
    timestamp(record.created_at)
  })
  return finish(value, [bearerToken])
}

export function parseDecisionResponse(value: unknown, bearerToken: string): JsonValue {
  const record = exactRecord(value, ['id', 'replayed'])
  uuid(record.id)
  boolean(record.replayed)
  return finish(value, [bearerToken])
}

export function parseProjectionPreparationResponse(value: unknown, bearerToken: string): JsonValue {
  const record = exactRecord(value, ['id', 'state', 'replayed'])
  uuid(record.id)
  enumeration(record.state, PUBLICATION_STATES)
  boolean(record.replayed)
  return finish(value, [bearerToken])
}

function projectionItem(value: unknown): void {
  const record = exactRecord(value, ['target_path', 'patch_digest_sha256', 'patch_operations'])
  if (typeof record.target_path !== 'string' ||
    !(APPROVED_PUBLICATION_PATHS as readonly string[]).includes(record.target_path)) invalid()
  sha256(record.patch_digest_sha256)
  const operations = exactArray(record.patch_operations, 1)
  if (operations.length !== 1) invalid()
  const operation = exactRecord(operations[0], ['op', 'expectedFileSha256', 'content'])
  if (operation.op !== 'replace') invalid()
  sha256(operation.expectedFileSha256)
  if (typeof operation.content !== 'string' || Buffer.byteLength(operation.content, 'utf8') > 65_536) invalid()
}

function projectionApproval(value: unknown): void {
  const record = exactRecord(value, [
    'approval_id', 'proposal_id', 'proposal_version', 'patch_digest_sha256', 'decided_at',
  ])
  uuid(record.approval_id)
  uuid(record.proposal_id)
  integer(record.proposal_version, 1, 2_147_483_647)
  sha256(record.patch_digest_sha256)
  timestamp(record.decided_at)
}

export function parseProjectionBundleResponse(value: unknown, bearerToken: string): JsonValue {
  const record = exactRecord(value, [
    'id', 'client_id', 'source_cutoff', 'git_remote', 'base_revision', 'state',
    'bundle_digest_sha256', 'accepted_revision', 'created_at', 'items', 'approvals',
  ])
  uuid(record.id)
  uuid(record.client_id)
  timestamp(record.source_cutoff)
  boundedString(record.git_remote, 1_024)
  revision(record.base_revision)
  enumeration(record.state, PUBLICATION_STATES)
  sha256(record.bundle_digest_sha256)
  revision(record.accepted_revision, true)
  timestamp(record.created_at)
  for (const item of exactArray(record.items, 5)) projectionItem(item)
  for (const item of exactArray(record.approvals, 100)) projectionApproval(item)
  return finish(value, [bearerToken])
}
