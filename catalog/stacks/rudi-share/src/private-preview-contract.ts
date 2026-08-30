import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import {
  ArtifactPackagingError,
  type MaterializedStaticArtifact,
} from './artifact.js'
import { PREVIEW_HEALTH_PATH } from './preview-host.js'

const STATE_SCHEMA_VERSION = 1
export const MIN_HTTPS_PORT = 8_443
export const MAX_HTTPS_PORT = 9_443
export const COMMAND_TIMEOUT_MS = 15_000
export const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const MAX_STATE_BYTES = 8 * 1024 * 1024
const MAX_REVOKED_PREVIEWS = 128
export const DEFAULT_STATE_ROOT = join(homedir(), '.rudi', 'state', 'rudi-share')
export const RUNTIME_ENV_KEYS = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'WINDIR',
] as const

export type PrivatePreviewErrorCode =
  | ArtifactPackagingError['code']
  | 'TAILSCALE_NOT_FOUND'
  | 'TAILSCALE_OFFLINE'
  | 'TAILSCALE_INVALID_STATUS'
  | 'TAILSCALE_SERVE_APPROVAL_REQUIRED'
  | 'TAILSCALE_SERVE_FAILED'
  | 'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH'
  | 'TAILSCALE_PORT_EXHAUSTED'
  | 'PREVIEW_PORT_CONFLICT'
  | 'PREVIEW_HOST_START_FAILED'
  | 'PREVIEW_HEALTH_CHECK_FAILED'
  | 'PREVIEW_ARTIFACT_CLEANUP_FAILED'
  | 'STALE_PREVIEW_PROCESS'
  | 'PREVIEW_STATE_BUSY'
  | 'PREVIEW_STATE_INVALID'
  | 'PREVIEW_STATE_LIMIT_EXCEEDED'
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_IDEMPOTENCY_CONFLICT'
  | 'PARTIAL_STARTUP_CLEANUP_FAILED'
  | 'PARTIAL_REVOCATION_CLEANUP_FAILED'

export class PrivatePreviewError extends Error {
  constructor(
    public readonly code: PrivatePreviewErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly receipt?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'PrivatePreviewError'
  }
}

export interface PrivatePreviewArtifact {
  sourcePath: string
  sha256: string
  fileCount: number
  totalBytes: number
}

export interface PrivatePreviewHealth {
  status: 'healthy' | 'degraded' | 'revoked'
  loopback: boolean
  tailnet: boolean
  checkedAt: string
  failureCode: string | null
}

export interface PrivatePreviewSummary {
  id: string
  name: string
  status: 'healthy' | 'degraded' | 'revoked'
  url: string
  httpsPort: number
  artifact: PrivatePreviewArtifact
  health: PrivatePreviewHealth
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

export interface PrivatePreviewPublishResult {
  outcome: 'published'
  access: 'Tailnet private'
  provider: 'tailscale_serve'
  preview: PrivatePreviewSummary
}

export interface PrivatePreviewGetResult {
  access: 'Tailnet private'
  provider: 'tailscale_serve'
  preview: PrivatePreviewSummary
}

export interface PrivatePreviewUnpublishResult {
  outcome: 'unpublished'
  access: 'Tailnet private'
  provider: 'tailscale_serve'
  preview: PrivatePreviewSummary
  receipt: {
    routeRevoked: boolean
    hostStopped: boolean
    artifactRemoved: boolean
    staleProcess: boolean
    revokedAt: string
  }
}

export interface HostIdentity {
  pid: number
  port: number
  url: string
}

export interface HostCheckInput extends HostIdentity {
  previewId: string
  artifactSha256: string
}

export interface PreviewHostController {
  start(input: {
    artifactRoot: string
    previewId: string
    artifactSha256: string
    port: number
  }, options?: {
    beforeDetach?: (identity: HostIdentity) => Promise<void>
  }): Promise<HostIdentity>
  check(input: HostCheckInput): Promise<boolean>
  stop(input: HostCheckInput): Promise<{ stopped: boolean; stale: boolean }>
}

export interface TailnetStatus {
  online: boolean
  dnsName: string
}

export interface TailnetRoute {
  httpsPort: number
  targetUrl: string | null
  handlerCount?: number
}

export interface TailnetProvider {
  status(): Promise<TailnetStatus>
  listRoutes(): Promise<TailnetRoute[]>
  serve(input: { httpsPort: number; targetUrl: string }): Promise<{ url: string }>
  revoke(input: { httpsPort: number; targetUrl: string }): Promise<void>
}

export interface PrivatePreviewRecord {
  id: string
  name: string
  lifecycle: 'starting' | 'active' | 'cleanup_required' | 'revoked'
  status: 'healthy' | 'degraded' | 'revoked'
  url: string
  httpsPort: number
  loopbackPort: number
  hostPid: number | null
  targetUrl: string
  tailnetDnsName: string
  artifact: PrivatePreviewArtifact
  createdAt: string
  updatedAt: string
  revokedAt: string | null
  lastHealth: PrivatePreviewHealth
  revocationReceipt: PrivatePreviewUnpublishResult['receipt'] | null
}

export interface PreviewState {
  schemaVersion: 1
  previews: Record<string, PrivatePreviewRecord>
}

export interface CreatePrivatePreviewServiceOptions {
  stateRoot?: string
  now?: () => Date
  materializeArtifact?: (
    sourcePath: string,
    destinationPath: string
  ) => Promise<MaterializedStaticArtifact>
  allocateLoopbackPort?: () => Promise<number>
  host?: PreviewHostController
  tailscale?: TailnetProvider
  checkTailnetHealth?: (
    url: string,
    expected: { previewId: string; artifactSha256: string; pid: number }
  ) => Promise<boolean>
  removeArtifact?: (path: string) => Promise<void>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeUrl(value: string): string {
  const url = new URL(value)
  if (url.pathname !== '/') url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.toString()
}

export function runtimeEnvironment(
  additional: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...additional }
  for (const key of RUNTIME_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return environment
}

export function healthUrl(baseUrl: string): string {
  return new URL(PREVIEW_HEALTH_PATH, baseUrl).toString()
}

export function previewIdFor(idempotencyKey: string): string {
  return `private_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 20)}`
}

export function summarize(record: PrivatePreviewRecord): PrivatePreviewSummary {
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    url: record.url,
    httpsPort: record.httpsPort,
    artifact: record.artifact,
    health: record.lastHealth,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  }
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function validLoopbackUrl(value: unknown, port: number): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port === String(port) &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.toString() === value
    )
  } catch {
    return false
  }
}

export function validTailnetUrl(
  value: unknown,
  dnsName: string,
  port: number
): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === dnsName &&
      url.port === String(port) &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.toString() === value
    )
  } catch {
    return false
  }
}

export function validHostIdentity(value: HostIdentity): boolean {
  return (
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    Number.isInteger(value.port) &&
    value.port >= 1 &&
    value.port <= 65_535 &&
    validLoopbackUrl(value.url, value.port)
  )
}

function validateRecord(
  value: unknown,
  expectedId: string
): value is PrivatePreviewRecord {
  if (!isRecord(value) || !isRecord(value.artifact) || !isRecord(value.lastHealth)) {
    return false
  }
  const status = String(value.status)
  const lifecycle = String(value.lifecycle)
  const httpsPort = Number(value.httpsPort)
  const loopbackPort = Number(value.loopbackPort)
  const tailnetDnsName = value.tailnetDnsName
  const revokedAt = value.revokedAt
  const healthStatus = String(value.lastHealth.status)
  const failureCode = value.lastHealth.failureCode
  const revocationReceipt = value.revocationReceipt
  const validRevocationReceipt =
    revocationReceipt === null ||
    (isRecord(revocationReceipt) &&
      typeof revocationReceipt.routeRevoked === 'boolean' &&
      typeof revocationReceipt.hostStopped === 'boolean' &&
      typeof revocationReceipt.artifactRemoved === 'boolean' &&
      typeof revocationReceipt.staleProcess === 'boolean' &&
      validTimestamp(revocationReceipt.revokedAt))
  const validHostPid =
    (Number.isSafeInteger(value.hostPid) && Number(value.hostPid) > 0) ||
    (value.hostPid === null &&
      ((lifecycle === 'cleanup_required' &&
        failureCode === 'PARTIAL_STARTUP_CLEANUP_FAILED') ||
        (lifecycle === 'revoked' &&
          isRecord(revocationReceipt) &&
          revocationReceipt.routeRevoked === true &&
          revocationReceipt.hostStopped === true)))
  return (
    typeof value.id === 'string' &&
    value.id === expectedId &&
    /^private_[a-f0-9]{20}$/.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 128 &&
    !/[\0\r\n]/.test(value.name) &&
    ['starting', 'active', 'cleanup_required', 'revoked'].includes(lifecycle) &&
    ['healthy', 'degraded', 'revoked'].includes(status) &&
    Number.isInteger(httpsPort) &&
    httpsPort >= MIN_HTTPS_PORT &&
    httpsPort <= MAX_HTTPS_PORT &&
    Number.isInteger(loopbackPort) &&
    loopbackPort >= 1 &&
    loopbackPort <= 65_535 &&
    validHostPid &&
    typeof tailnetDnsName === 'string' &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(tailnetDnsName) &&
    tailnetDnsName.length <= 253 &&
    validTailnetUrl(value.url, tailnetDnsName, httpsPort) &&
    validLoopbackUrl(value.targetUrl, loopbackPort) &&
    typeof value.artifact.sourcePath === 'string' &&
    isAbsolute(value.artifact.sourcePath) &&
    value.artifact.sourcePath.length <= 4_096 &&
    typeof value.artifact.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.artifact.sha256) &&
    Number.isInteger(value.artifact.fileCount) &&
    Number(value.artifact.fileCount) >= 1 &&
    Number(value.artifact.fileCount) <= 2_000 &&
    Number.isSafeInteger(value.artifact.totalBytes) &&
    Number(value.artifact.totalBytes) >= 0 &&
    Number(value.artifact.totalBytes) <= 25 * 1024 * 1024 &&
    validTimestamp(value.createdAt) &&
    validTimestamp(value.updatedAt) &&
    (revokedAt === null || validTimestamp(revokedAt)) &&
    ((status === 'revoked' && revokedAt !== null) ||
      (status !== 'revoked' && revokedAt === null)) &&
    healthStatus === status &&
    typeof value.lastHealth.loopback === 'boolean' &&
    typeof value.lastHealth.tailnet === 'boolean' &&
    validTimestamp(value.lastHealth.checkedAt) &&
    (failureCode === null || typeof failureCode === 'string') &&
    (status !== 'healthy' ||
      (value.lastHealth.loopback === true &&
        value.lastHealth.tailnet === true &&
        failureCode === null)) &&
    (status !== 'degraded' || failureCode !== null) &&
    (status !== 'revoked' ||
      (value.lastHealth.loopback === false &&
        value.lastHealth.tailnet === false)) &&
    validRevocationReceipt &&
    ((status === 'revoked' &&
      isRecord(revocationReceipt) &&
      revocationReceipt.routeRevoked === true &&
      revocationReceipt.revokedAt === revokedAt) ||
      (status !== 'revoked' && revocationReceipt === null)) &&
    ((status === 'healthy' && lifecycle === 'active') ||
      (status === 'degraded' &&
        ['starting', 'active', 'cleanup_required'].includes(lifecycle)) ||
      (status === 'revoked' && lifecycle === 'revoked'))
  )
}

export async function readState(stateRoot: string): Promise<PreviewState> {
  const statePath = join(stateRoot, 'private-previews.json')
  try {
    const info = await stat(statePath)
    if (!info.isFile() || info.size > MAX_STATE_BYTES) {
      throw new PrivatePreviewError(
        'PREVIEW_STATE_INVALID',
        'Private preview state is invalid.'
      )
    }
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as unknown
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== STATE_SCHEMA_VERSION ||
      !isRecord(parsed.previews) ||
      !Object.entries(parsed.previews).every(([id, value]) =>
        validateRecord(value, id)
      )
    ) {
      throw new PrivatePreviewError(
        'PREVIEW_STATE_INVALID',
        'Private preview state is invalid.'
      )
    }
    return parsed as unknown as PreviewState
  } catch (error) {
    if (error instanceof PrivatePreviewError) throw error
    if (error instanceof SyntaxError) {
      throw new PrivatePreviewError(
        'PREVIEW_STATE_INVALID',
        'Private preview state is invalid.'
      )
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { schemaVersion: STATE_SCHEMA_VERSION, previews: {} }
    }
    throw error
  }
}

export async function writeState(stateRoot: string, state: PreviewState): Promise<void> {
  const revoked = Object.entries(state.previews)
    .filter(
      ([, preview]) =>
        preview.status === 'revoked' &&
        preview.revocationReceipt?.hostStopped === true &&
        preview.revocationReceipt.artifactRemoved === true
    )
    .sort((left, right) => {
      const timestampOrder = right[1].updatedAt.localeCompare(
        left[1].updatedAt,
        'en'
      )
      return timestampOrder || right[0].localeCompare(left[0], 'en')
    })
  for (const [previewId] of revoked.slice(MAX_REVOKED_PREVIEWS)) {
    delete state.previews[previewId]
  }
  const serialized = `${JSON.stringify(state, null, 2)}\n`
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) {
    throw new PrivatePreviewError(
      'PREVIEW_STATE_LIMIT_EXCEEDED',
      'Private preview state exceeds its safe storage limit.'
    )
  }
  await mkdir(stateRoot, { recursive: true, mode: 0o700 })
  const statePath = join(stateRoot, 'private-previews.json')
  const temporaryPath = join(
    stateRoot,
    `.private-previews.${process.pid}.${randomUUID()}.tmp`
  )
  await writeFile(temporaryPath, serialized, {
    mode: 0o600,
    flag: 'wx',
  })
  await rename(temporaryPath, statePath)
}

async function acquireStateLock(
  lockPath: string,
  allowStaleRecovery = true
): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    const handle = await open(lockPath, 'wx', 0o600)
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
      )
      return handle
    } catch (error) {
      await handle.close()
      await unlink(lockPath).catch(() => undefined)
      throw error
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error
    }
    if (allowStaleRecovery) {
      try {
        const info = await stat(lockPath)
        const lockText = info.isFile() && info.size <= 4_096
          ? await readFile(lockPath, 'utf8')
          : ''
        const lock = JSON.parse(lockText) as unknown
        if (
          isRecord(lock) &&
          Number.isInteger(lock.pid) &&
          Number(lock.pid) > 0 &&
          !(await processExists(Number(lock.pid))) &&
          await readFile(lockPath, 'utf8') === lockText
        ) {
          await unlink(lockPath)
          return acquireStateLock(lockPath, false)
        }
      } catch {
        // Invalid, changing, or live lock ownership remains fail-closed.
      }
    }
    throw new PrivatePreviewError(
      'PREVIEW_STATE_BUSY',
      'Private preview state is busy; retry the operation.',
      true
    )
  }
}

export async function withStateLock<T>(
  stateRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 })
  const lockPath = join(stateRoot, 'private-previews.lock')
  const handle = await acquireStateLock(lockPath)

  try {
    return await operation()
  } finally {
    await handle.close()
    await unlink(lockPath).catch(() => undefined)
  }
}



export async function processExists(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    )
  }
}
