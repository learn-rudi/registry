import { createHash } from 'node:crypto'

export const APPROVED_PUBLICATION_PATHS = [
  'workspace/contacts.md',
  'workspace/context.md',
  'workspace/interaction-log.md',
  'workspace/next-steps.md',
  'workspace/decisions.md',
] as const

// JSON Schema maxLength counts Unicode code points while the API bounds UTF-8
// bytes. Five thousand code points can occupy at most 20,000 UTF-8 bytes.
export const MAX_PUBLICATION_CONTENT_CHARACTERS = 5_000
export const MAX_PUBLICATION_CONTENT_BYTES = 20_000

export type ApprovedPublicationPath = typeof APPROVED_PUBLICATION_PATHS[number]
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type PageInput = { limit: number; cursor?: string }

export class ToolInputError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'UNKNOWN_TOOL', message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const REVISION_PATTERN = /^[0-9a-f]{40,64}$/
const OFFSET_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolInputError('INVALID_INPUT', 'Tool arguments must be an object.')
  }
  return value as Record<string, unknown>
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(input).find((key) => !allowedSet.has(key))
  if (unknown !== undefined) {
    throw new ToolInputError('INVALID_INPUT', `Unknown input field: ${unknown}.`)
  }
}

export function requiredString(
  input: Record<string, unknown>,
  field: string,
  maximum: number,
  minimum = 1,
): string {
  const value = input[field]
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    value.length > maximum ||
    /[\0\r\n]/.test(value)
  ) {
    throw new ToolInputError(
      'INVALID_INPUT',
      `${field} must be a string between ${minimum} and ${maximum} characters.`,
    )
  }
  return value
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
  maximum: number,
): string | undefined {
  return input[field] === undefined ? undefined : requiredString(input, field, maximum)
}

export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ToolInputError('INVALID_INPUT', `${field} must be a UUID.`)
  }
  return value.toLowerCase()
}

function assertSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new ToolInputError('INVALID_INPUT', `${field} must be a lowercase SHA-256 digest.`)
  }
  return value
}

function assertRevision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) {
    throw new ToolInputError('INVALID_INPUT', `${field} must be a 40-64 character lowercase Git revision.`)
  }
  return value
}

export function isRfc3339DateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = OFFSET_DATE_TIME_PATTERN.exec(value)
  if (match === null) return false
  const dateTime = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})/.exec(value)
  if (dateTime === null) return false
  const year = Number(dateTime[1])
  const month = Number(dateTime[2])
  const day = Number(dateTime[3])
  const hour = Number(dateTime[4])
  const minute = Number(dateTime[5])
  const second = Number(dateTime[6])
  const offset = /([+-])([0-9]{2}):([0-9]{2})$/.exec(value)
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= monthLengths[month - 1]!
}

function assertDateTime(value: unknown, field: string): string {
  if (!isRfc3339DateTime(value)) {
    throw new ToolInputError('INVALID_INPUT', `${field} must be an ISO-8601 timestamp with an offset.`)
  }
  return value
}

function integer(
  input: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
  defaultValue?: number,
): number {
  const value = input[field] ?? defaultValue
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ToolInputError('INVALID_INPUT', `${field} must be an integer from ${minimum} to ${maximum}.`)
  }
  return Number(value)
}

export function parsePageInput(value: unknown): PageInput {
  const input = asRecord(value)
  exactKeys(input, ['limit', 'cursor'])
  const limit = integer(input, 'limit', 1, 100, 25)
  const cursor = input.cursor === undefined ? undefined : assertUuid(input.cursor, 'cursor')
  return cursor === undefined ? { limit } : { limit, cursor }
}

export interface ContextInput extends PageInput {
  clientId?: string
  organizationId?: string
}

export function parseClientContextInput(value: unknown): Required<Pick<ContextInput, 'clientId'>> & PageInput {
  const input = asRecord(value)
  exactKeys(input, ['client_id', 'limit', 'cursor'])
  const page = parsePageInput({ limit: input.limit, cursor: input.cursor })
  return { clientId: assertUuid(input.client_id, 'client_id'), ...page }
}

export function parseOrganizationContextInput(value: unknown): Required<Pick<ContextInput, 'organizationId'>> & PageInput {
  const input = asRecord(value)
  exactKeys(input, ['organization_id', 'limit', 'cursor'])
  const page = parsePageInput({ limit: input.limit, cursor: input.cursor })
  return { organizationId: assertUuid(input.organization_id, 'organization_id'), ...page }
}

export interface InteractionListInput extends PageInput {
  clientId?: string
  organizationId?: string
  kind?: string
}

export function parseInteractionListInput(value: unknown): InteractionListInput {
  const input = asRecord(value)
  exactKeys(input, ['limit', 'cursor', 'client_id', 'organization_id', 'kind'])
  return compact({
    ...parsePageInput({ limit: input.limit, cursor: input.cursor }),
    clientId: input.client_id === undefined ? undefined : assertUuid(input.client_id, 'client_id'),
    organizationId: input.organization_id === undefined
      ? undefined
      : assertUuid(input.organization_id, 'organization_id'),
    kind: optionalString(input, 'kind', 128),
  })
}

export interface ObservationListInput extends PageInput { kind?: string }

export function parseObservationListInput(value: unknown): ObservationListInput {
  const input = asRecord(value)
  exactKeys(input, ['limit', 'cursor', 'kind'])
  return compact({
    ...parsePageInput({ limit: input.limit, cursor: input.cursor }),
    kind: optionalString(input, 'kind', 128),
  })
}

export interface CandidateListInput extends PageInput {
  clientId?: string
  state?: string
  kind?: string
}

export function parseCandidateListInput(value: unknown): CandidateListInput {
  const input = asRecord(value)
  exactKeys(input, ['limit', 'cursor', 'client_id', 'state', 'kind'])
  return compact({
    ...parsePageInput({ limit: input.limit, cursor: input.cursor }),
    clientId: input.client_id === undefined ? undefined : assertUuid(input.client_id, 'client_id'),
    state: optionalString(input, 'state', 128),
    kind: optionalString(input, 'kind', 128),
  })
}

export interface CandidateReviewInput {
  candidateId: string
  expectedVersion: number
  proposalDigest: string
  decision: 'approve' | 'reject'
  reason: string
  idempotencyKey: string
}

export function parseCandidateReviewInput(value: unknown): CandidateReviewInput {
  const input = asRecord(value)
  exactKeys(input, [
    'candidate_id', 'expected_version', 'proposal_digest', 'decision', 'reason', 'idempotency_key',
  ])
  const decision = input.decision
  if (decision !== 'approve' && decision !== 'reject') {
    throw new ToolInputError('INVALID_INPUT', 'decision must be approve or reject.')
  }
  return {
    candidateId: assertUuid(input.candidate_id, 'candidate_id'),
    expectedVersion: integer(input, 'expected_version', 1, 2_147_483_647),
    proposalDigest: assertSha256(input.proposal_digest, 'proposal_digest'),
    decision,
    reason: requiredString(input, 'reason', 2_000),
    idempotencyKey: requiredString(input, 'idempotency_key', 256),
  }
}

export interface PublicationPreparationItemInput {
  target_path: ApprovedPublicationPath
  expected_file_sha256: string
  content: string
}

export interface PublicationPreparationInput {
  clientId: string
  approvalIds: string[]
  sourceCutoff: string
  gitRemote: string
  baseRevision: string
  idempotencyKey: string
  items: PublicationPreparationItemInput[]
}

function parseGitRemote(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1_024 || /[\0\r\n\s]/.test(value)) {
    throw new ToolInputError('INVALID_INPUT', 'git_remote must be a bounded HTTPS or SSH Git remote.')
  }
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(value)) return value
  let url: URL
  try { url = new URL(value) } catch {
    throw new ToolInputError('INVALID_INPUT', 'git_remote must be a bounded HTTPS or SSH Git remote.')
  }
  if (
    !['https:', 'ssh:'].includes(url.protocol) ||
    url.hostname.length === 0 ||
    url.pathname.length <= 1 ||
    (url.protocol === 'https:' && url.username.length > 0) ||
    (url.protocol === 'ssh:' && url.username !== 'git') ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ToolInputError('INVALID_INPUT', 'git_remote must be a bounded HTTPS or SSH Git remote.')
  }
  return value
}

export function parsePublicationPreparationInput(value: unknown): PublicationPreparationInput {
  const input = asRecord(value)
  exactKeys(input, [
    'client_id', 'approval_ids', 'source_cutoff', 'git_remote', 'base_revision', 'idempotency_key', 'items',
  ])
  if (!Array.isArray(input.approval_ids) || input.approval_ids.length < 1 || input.approval_ids.length > 100) {
    throw new ToolInputError('INVALID_INPUT', 'approval_ids must contain 1 to 100 UUIDs.')
  }
  const approvalIds = input.approval_ids.map((value) => assertUuid(value, 'approval_ids'))
  if (new Set(approvalIds).size !== approvalIds.length) {
    throw new ToolInputError('INVALID_INPUT', 'approval_ids must not contain duplicates.')
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 5) {
    throw new ToolInputError('INVALID_INPUT', 'items must contain 1 to 5 governed changes.')
  }
  const items = input.items.map((value): PublicationPreparationItemInput => {
    const item = asRecord(value)
    exactKeys(item, ['target_path', 'expected_file_sha256', 'content'])
    if (
      typeof item.target_path !== 'string' ||
      !(APPROVED_PUBLICATION_PATHS as readonly string[]).includes(item.target_path)
    ) {
      throw new ToolInputError('INVALID_INPUT', 'target_path is not an approved client workspace file.')
    }
    if (
      typeof item.content !== 'string' ||
      Array.from(item.content).length > MAX_PUBLICATION_CONTENT_CHARACTERS ||
      Buffer.byteLength(item.content, 'utf8') > MAX_PUBLICATION_CONTENT_BYTES
    ) {
      throw new ToolInputError(
        'INVALID_INPUT',
        `content must be at most ${MAX_PUBLICATION_CONTENT_CHARACTERS} characters and ${MAX_PUBLICATION_CONTENT_BYTES} UTF-8 bytes.`,
      )
    }
    return {
      target_path: item.target_path as ApprovedPublicationPath,
      expected_file_sha256: assertSha256(item.expected_file_sha256, 'expected_file_sha256'),
      content: item.content,
    }
  })
  if (new Set(items.map((item) => item.target_path)).size !== items.length) {
    throw new ToolInputError('INVALID_INPUT', 'items must not contain duplicate target_path values.')
  }
  return {
    clientId: assertUuid(input.client_id, 'client_id'),
    approvalIds,
    sourceCutoff: assertDateTime(input.source_cutoff, 'source_cutoff'),
    gitRemote: parseGitRemote(input.git_remote),
    baseRevision: assertRevision(input.base_revision, 'base_revision'),
    idempotencyKey: requiredString(input, 'idempotency_key', 256),
    items,
  }
}

export interface PublicationItemV1 {
  targetPath: ApprovedPublicationPath
  patchDigest: string
  operation: {
    op: 'replace'
    expectedFileSha256: string
    content: string
  }
}

export interface PublicationBundleRequest {
  approvalIds: string[]
  sourceCutoff: string
  gitRemote: string
  baseRevision: string
  bundleDigest: string
  items: PublicationItemV1[]
}

export function buildPublicationBundle(
  tenantId: string,
  input: PublicationPreparationInput,
): PublicationBundleRequest {
  const items: PublicationItemV1[] = input.items.map((item) => {
    const operation = {
      op: 'replace' as const,
      expectedFileSha256: item.expected_file_sha256,
      content: item.content,
    }
    const patchDigest = createHash('sha256').update(JSON.stringify({
      targetPath: item.target_path,
      operation,
    }), 'utf8').digest('hex')
    return { targetPath: item.target_path, patchDigest, operation }
  })
  const bundleDigest = createHash('sha256').update(JSON.stringify({
    tenantId,
    clientId: input.clientId,
    approvalIds: [...input.approvalIds].sort(),
    sourceCutoff: input.sourceCutoff,
    gitRemote: input.gitRemote,
    baseRevision: input.baseRevision,
    items: [...items]
      .sort((left, right) => left.targetPath.localeCompare(right.targetPath, 'en'))
      .map((item) => ({ targetPath: item.targetPath, patchDigest: item.patchDigest })),
  }), 'utf8').digest('hex')
  return {
    approvalIds: input.approvalIds,
    sourceCutoff: input.sourceCutoff,
    gitRemote: input.gitRemote,
    baseRevision: input.baseRevision,
    bundleDigest,
    items,
  }
}

export interface ProjectionBundleInput { projectionRunId: string }

export function parseProjectionBundleInput(value: unknown): ProjectionBundleInput {
  const input = asRecord(value)
  exactKeys(input, ['projection_run_id'])
  return { projectionRunId: assertUuid(input.projection_run_id, 'projection_run_id') }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}
