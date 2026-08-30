import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ArtifactPackagingError,
  materializeStaticArtifact,
  type ArtifactManifest,
  type MaterializedStaticArtifact,
} from './artifact.js'
import { PREVIEW_HEALTH_PATH } from './preview-host.js'

const STATE_SCHEMA_VERSION = 1
const MIN_HTTPS_PORT = 8_443
const MAX_HTTPS_PORT = 9_443
const COMMAND_TIMEOUT_MS = 15_000
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const MAX_STATE_BYTES = 8 * 1024 * 1024
const MAX_REVOKED_PREVIEWS = 128
const DEFAULT_STATE_ROOT = join(homedir(), '.rudi', 'state', 'rudi-share')
const RUNTIME_ENV_KEYS = [
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

interface HostCheckInput extends HostIdentity {
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

interface TailnetStatus {
  online: boolean
  dnsName: string
}

interface TailnetRoute {
  httpsPort: number
  targetUrl: string | null
  handlerCount?: number
}

interface TailnetProvider {
  status(): Promise<TailnetStatus>
  listRoutes(): Promise<TailnetRoute[]>
  serve(input: { httpsPort: number; targetUrl: string }): Promise<{ url: string }>
  revoke(input: { httpsPort: number; targetUrl: string }): Promise<void>
}

interface PrivatePreviewRecord {
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

interface PreviewState {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeUrl(value: string): string {
  const url = new URL(value)
  if (url.pathname !== '/') url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.toString()
}

function runtimeEnvironment(
  additional: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...additional }
  for (const key of RUNTIME_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return environment
}

function healthUrl(baseUrl: string): string {
  return new URL(PREVIEW_HEALTH_PATH, baseUrl).toString()
}

function previewIdFor(idempotencyKey: string): string {
  return `private_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 20)}`
}

function summarize(record: PrivatePreviewRecord): PrivatePreviewSummary {
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

function validTailnetUrl(
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

function validHostIdentity(value: HostIdentity): boolean {
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

async function readState(stateRoot: string): Promise<PreviewState> {
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

async function writeState(stateRoot: string, state: PreviewState): Promise<void> {
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

async function withStateLock<T>(
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

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', () =>
      reject(
        new PrivatePreviewError(
          'PREVIEW_PORT_CONFLICT',
          'A free loopback preview port could not be allocated.',
          true
        )
      )
    )
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(
          new PrivatePreviewError(
            'PREVIEW_PORT_CONFLICT',
            'A free loopback preview port could not be allocated.',
            true
          )
        )
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

function childHostModule(): { path: string; execArguments: string[] } {
  const currentPath = fileURLToPath(import.meta.url)
  const sourceMode = extname(currentPath) === '.ts'
  const path = fileURLToPath(
    new URL(sourceMode ? './preview-host.ts' : './preview-host.js', import.meta.url)
  )
  return {
    path,
    execArguments: sourceMode ? ['--import', 'tsx'] : [],
  }
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('exit', onExit)
      resolve(value)
    }
    const onExit = () => finish(true)
    const timeout = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
  })
}

async function terminateManagedChild(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  const pid = child.pid
  if (child.connected) child.disconnect()
  if (!pid || !(await processExists(pid))) {
    child.unref()
    return true
  }
  child.kill('SIGTERM')
  let stopped = await waitForChildExit(child, timeoutMs)
  if (!stopped && await processExists(pid)) {
    child.kill('SIGKILL')
    stopped = await waitForChildExit(child, timeoutMs)
  }
  child.unref()
  return stopped && !(await processExists(pid))
}

async function activateManagedChild(
  child: ChildProcess,
  identity: HostIdentity,
  input: { previewId: string; artifactSha256: string },
  timeoutMs: number
): Promise<void> {
  if (!child.connected) {
    throw new PrivatePreviewError(
      'PREVIEW_HOST_START_FAILED',
      'The loopback preview host disconnected before activation.',
      true
    )
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('disconnect', onDisconnect)
      child.off('exit', onExit)
      callback()
    }
    const fail = () => finish(() => reject(
      new PrivatePreviewError(
        'PREVIEW_HOST_START_FAILED',
        'The loopback preview host could not activate safely.',
        true
      )
    ))
    const onMessage = (message: unknown) => {
      if (
        isRecord(message) &&
        message.type === 'activated' &&
        message.pid === identity.pid &&
        message.port === identity.port
      ) {
        finish(resolve)
      }
    }
    const onDisconnect = () => fail()
    const onExit = () => fail()
    const timeout = setTimeout(fail, timeoutMs)
    child.on('message', onMessage)
    child.once('disconnect', onDisconnect)
    child.once('exit', onExit)
    child.send({
      type: 'activate',
      pid: identity.pid,
      port: identity.port,
      previewId: input.previewId,
      artifactSha256: input.artifactSha256,
    }, (error) => {
      if (error) fail()
    })
  })
}

export async function startManagedPreviewHostProcess(input: {
  artifactRoot: string
  previewId: string
  artifactSha256: string
  port: number
}, options: {
  modulePath?: string
  execArguments?: string[]
  readinessTimeoutMs?: number
  stopTimeoutMs?: number
  activationTimeoutMs?: number
  beforeDetach?: (identity: HostIdentity) => Promise<void>
} = {}): Promise<HostIdentity> {
  const defaultModule = childHostModule()
  const module = {
    path: options.modulePath ?? defaultModule.path,
    execArguments: options.execArguments ?? defaultModule.execArguments,
  }
  const child = spawn(
    process.execPath,
    [
      ...module.execArguments,
      module.path,
      input.artifactRoot,
      input.previewId,
      input.artifactSha256,
      String(input.port),
    ],
    {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: runtimeEnvironment(),
    }
  )

  let detachReadinessListeners = () => undefined
  try {
    const receipt = await new Promise<HostIdentity>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      detachReadinessListeners()
      callback()
    }
    const timeout = setTimeout(() => {
      finish(() =>
        reject(
          new PrivatePreviewError(
            'PREVIEW_HOST_START_FAILED',
            'The loopback preview host did not become ready.',
            true
          )
        )
      )
    }, options.readinessTimeoutMs ?? 10_000)
    const onError = () =>
      finish(() =>
        reject(
          new PrivatePreviewError(
            'PREVIEW_HOST_START_FAILED',
            'The loopback preview host could not start.',
            true
          )
        )
      )
    const onExit = () =>
      finish(() =>
        reject(
          new PrivatePreviewError(
            'PREVIEW_HOST_START_FAILED',
            'The loopback preview host exited before readiness.',
            true
          )
        )
      )
    const onMessage = (message: unknown) => {
      finish(() => {
        if (
          isRecord(message) &&
          message.type === 'ready' &&
          typeof message.pid === 'number' &&
          Number.isSafeInteger(message.pid) &&
          message.pid === child.pid &&
          typeof message.port === 'number' &&
          Number.isInteger(message.port) &&
          message.port === input.port
        ) {
          resolve({
            pid: message.pid,
            port: message.port,
            url: `http://127.0.0.1:${message.port}/`,
          })
          return
        }
        const code = isRecord(message) && message.code === 'PREVIEW_PORT_CONFLICT'
          ? 'PREVIEW_PORT_CONFLICT'
          : 'PREVIEW_HOST_START_FAILED'
        reject(
          new PrivatePreviewError(
            code,
            code === 'PREVIEW_PORT_CONFLICT'
              ? 'The selected loopback preview port is already in use.'
              : 'The loopback preview host could not start.',
            true
          )
        )
      })
    }
    detachReadinessListeners = () => {
      child.off('error', onError)
      child.off('exit', onExit)
      child.off('message', onMessage)
    }
    child.once('error', onError)
    child.once('exit', onExit)
    child.once('message', onMessage)
    })
    await options.beforeDetach?.(receipt)
    await activateManagedChild(
      child,
      receipt,
      input,
      options.activationTimeoutMs ?? 3_000
    )
    if (child.connected) child.disconnect()
    child.unref()
    return receipt
  } catch (error) {
    detachReadinessListeners()
    const stopped = await terminateManagedChild(
      child,
      options.stopTimeoutMs ?? 3_000
    )
    if (!stopped) {
      throw new PrivatePreviewError(
        'PARTIAL_STARTUP_CLEANUP_FAILED',
        'The loopback preview host failed to start and could not be stopped safely.',
        false,
        { hostPid: child.pid ?? null, hostStopped: false }
      )
    }
    throw error
  }
}

export async function checkManagedPreviewHealth(
  baseUrl: string,
  expected: { previewId: string; artifactSha256: string; pid: number },
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const response = await fetchImpl(healthUrl(baseUrl), {
      signal: AbortSignal.timeout(3_000),
      headers: { accept: 'application/json' },
      redirect: 'manual',
    })
    if (!response.ok) return false
    const text = await response.text()
    if (Buffer.byteLength(text) > 16 * 1024) return false
    const body = JSON.parse(text) as unknown
    return (
      isRecord(body) &&
      body.status === 'healthy' &&
      body.previewId === expected.previewId &&
      body.artifactSha256 === expected.artifactSha256 &&
      body.pid === expected.pid
    )
  } catch {
    return false
  }
}

async function processExists(pid: number): Promise<boolean> {
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

function validHostCheckInput(input: HostCheckInput): boolean {
  return (
    validHostIdentity(input) &&
    /^private_[a-f0-9]{20}$/.test(input.previewId) &&
    /^[a-f0-9]{64}$/.test(input.artifactSha256)
  )
}

export function createManagedHostController(options: {
  check?: (input: HostCheckInput) => Promise<boolean>
  processExists?: (pid: number) => Promise<boolean>
  signal?: (pid: number, signal: NodeJS.Signals) => void
  stopTimeoutMs?: number
  pollIntervalMs?: number
} = {}): PreviewHostController {
  const check = options.check ?? (
    (input) => checkManagedPreviewHealth(input.url, input)
  )
  const exists = options.processExists ?? processExists
  const signal = options.signal ?? ((pid, value) => process.kill(pid, value))
  return {
    start: startManagedPreviewHostProcess,
    async check(input) {
      if (!validHostCheckInput(input)) return false
      return check(input)
    },
    async stop(input) {
      if (!validHostCheckInput(input)) {
        return { stopped: false, stale: true }
      }
      if (!(await this.check(input))) {
        return {
          stopped: !(await exists(input.pid)),
          stale: true,
        }
      }
      try {
        signal(input.pid, 'SIGTERM')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
          throw error
        }
      }
      const deadline = Date.now() + (options.stopTimeoutMs ?? 3_000)
      let stale = false
      while (Date.now() < deadline) {
        if (!(await this.check(input))) stale = true
        if (!(await exists(input.pid))) return { stopped: true, stale: false }
        await new Promise((resolve) =>
          setTimeout(resolve, options.pollIntervalMs ?? 50)
        )
      }
      return { stopped: false, stale }
    },
  }
}

const defaultHostController: PreviewHostController = createManagedHostController()

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveTailscaleBinary(): Promise<string> {
  const pathCandidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, process.platform === 'win32' ? 'tailscale.exe' : 'tailscale'))
  const candidates = process.platform === 'darwin'
    ? [
        ...pathCandidates,
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      ]
    : pathCandidates
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate
  }
  throw new PrivatePreviewError(
    'TAILSCALE_NOT_FOUND',
    'Tailscale is not installed or its CLI is unavailable.'
  )
}

export interface CommandResult {
  stdout: string
  stderr: string
}

async function runTailscale(args: string[]): Promise<CommandResult> {
  const binary = await resolveTailscaleBinary()
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        env: runtimeEnvironment({ TAILSCALE_BE_CLI: '1' }),
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr })
          return
        }
        const combined = `${stdout}\n${stderr}`
        if (/approval|required.*enable|admin\/feature\/serve/i.test(combined)) {
          reject(
            new PrivatePreviewError(
              'TAILSCALE_SERVE_APPROVAL_REQUIRED',
              'Tailnet approval is required before Tailscale Serve can expose this preview.'
            )
          )
          return
        }
        reject(
          new PrivatePreviewError(
            'TAILSCALE_SERVE_FAILED',
            'Tailscale Serve could not complete the requested endpoint change.',
            true
          )
        )
      }
    )
  })
}

function parseJsonOutput(output: string): Record<string, unknown> {
  try {
    const value = JSON.parse(output) as unknown
    if (!isRecord(value)) throw new Error('invalid')
    return value
  } catch {
    throw new PrivatePreviewError(
      'TAILSCALE_INVALID_STATUS',
      'Tailscale returned invalid status data.',
      true
    )
  }
}

function serveStatusPort(value: string): number {
  const separator = value.lastIndexOf(':')
  const rawPort = separator === -1 ? value : value.slice(separator + 1)
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PrivatePreviewError(
      'TAILSCALE_INVALID_STATUS',
      'Tailscale returned invalid Serve status data.',
      true
    )
  }
  return port
}

function requiredStatusMap(
  config: Record<string, unknown>,
  field: string
): Record<string, unknown> | undefined {
  const value = config[field]
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) {
    throw new PrivatePreviewError(
      'TAILSCALE_INVALID_STATUS',
      'Tailscale returned invalid Serve status data.',
      true
    )
  }
  return value
}

export function createTailscaleServeProvider(options: {
  run?: (args: string[]) => Promise<CommandResult>
} = {}): TailnetProvider {
  const run = options.run ?? runTailscale
  return {
  async status() {
    const body = parseJsonOutput((await run(['status', '--json'])).stdout)
    const self = body.Self
    const online = body.BackendState === 'Running' && isRecord(self) && self.Online === true
    if (!online) {
      throw new PrivatePreviewError(
        'TAILSCALE_OFFLINE',
        'Tailscale is installed but this device is offline.',
        true
      )
    }
    const rawDnsName = isRecord(self) ? self.DNSName : null
    if (typeof rawDnsName !== 'string' || rawDnsName.length > 253) {
      throw new PrivatePreviewError(
        'TAILSCALE_INVALID_STATUS',
        'Tailscale did not report a valid device DNS name.',
        true
      )
    }
    const dnsName = rawDnsName.replace(/\.$/, '').toLowerCase()
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(dnsName)) {
      throw new PrivatePreviewError(
        'TAILSCALE_INVALID_STATUS',
        'Tailscale did not report a valid device DNS name.',
        true
      )
    }
    return { online: true, dnsName }
  },

  async listRoutes() {
    const body = parseJsonOutput(
      (await run(['serve', 'status', '--json'])).stdout
    )
    const routes = new Map<number, TailnetRoute>()
    const protectedPorts = new Set<number>()
    const webClaims = new Set<number>()
    const reserve = (port: number) => {
      if (!routes.has(port)) routes.set(port, { httpsPort: port, targetUrl: null })
    }
    const protect = (port: number) => {
      reserve(port)
      protectedPorts.add(port)
      routes.set(port, { httpsPort: port, targetUrl: null })
    }
    const inspectConfig = (
      config: Record<string, unknown>,
      protectedConfig: boolean,
      depth: number
    ): void => {
      if (depth > 8) {
        throw new PrivatePreviewError(
          'TAILSCALE_INVALID_STATUS',
          'Tailscale returned invalid Serve status data.',
          true
        )
      }
      const tcp = requiredStatusMap(config, 'TCP')
      for (const rawPort of Object.keys(tcp ?? {})) {
        const port = serveStatusPort(rawPort)
        if (protectedConfig) protect(port)
        else reserve(port)
      }

      const web = requiredStatusMap(config, 'Web')
      for (const [hostPort, webConfig] of Object.entries(web ?? {})) {
        const port = serveStatusPort(hostPort)
        if (protectedConfig) {
          protect(port)
          continue
        }
        if (!isRecord(webConfig) || !isRecord(webConfig.Handlers)) {
          throw new PrivatePreviewError(
            'TAILSCALE_INVALID_STATUS',
            'Tailscale returned invalid Serve status data.',
            true
          )
        }
        if (webClaims.has(port)) {
          protect(port)
          continue
        }
        webClaims.add(port)
        const handlers = Object.entries(webConfig.Handlers)
        const rootHandler = webConfig.Handlers['/']
        let targetUrl: string | null = null
        if (isRecord(rootHandler) && typeof rootHandler.Proxy === 'string') {
          try {
            targetUrl = normalizeUrl(rootHandler.Proxy)
          } catch {
            throw new PrivatePreviewError(
              'TAILSCALE_INVALID_STATUS',
              'Tailscale returned invalid Serve status data.',
              true
            )
          }
        }
        routes.set(port, {
          httpsPort: port,
          targetUrl: protectedPorts.has(port) ? null : targetUrl,
          handlerCount: protectedPorts.has(port) ? undefined : handlers.length,
        })
      }

      const funnel = requiredStatusMap(config, 'AllowFunnel')
      for (const hostPort of Object.keys(funnel ?? {})) {
        protect(serveStatusPort(hostPort))
      }

      const foreground = requiredStatusMap(config, 'Foreground')
      for (const nested of Object.values(foreground ?? {})) {
        if (!isRecord(nested)) {
          throw new PrivatePreviewError(
            'TAILSCALE_INVALID_STATUS',
            'Tailscale returned invalid Serve status data.',
            true
          )
        }
        inspectConfig(nested, true, depth + 1)
      }

      const services = requiredStatusMap(config, 'Services')
      for (const nested of Object.values(services ?? {})) {
        if (!isRecord(nested)) {
          throw new PrivatePreviewError(
            'TAILSCALE_INVALID_STATUS',
            'Tailscale returned invalid Serve status data.',
            true
          )
        }
        inspectConfig(nested, true, depth + 1)
      }
    }

    inspectConfig(body, false, 0)
    return [...routes.values()].sort((left, right) => left.httpsPort - right.httpsPort)
  },

  async serve(input) {
    if (input.httpsPort === 443) {
      throw new PrivatePreviewError(
        'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH',
        'RUDI Share will not modify the reserved HTTPS 443 route.'
      )
    }
    const target = new URL(input.targetUrl)
    if (
      target.protocol !== 'http:' ||
      target.hostname !== '127.0.0.1' ||
      target.username ||
      target.password ||
      target.pathname !== '/'
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_SERVE_FAILED',
        'Private preview target must be a loopback HTTP endpoint.'
      )
    }
    await run([
      'serve',
      '--bg',
      `--https=${input.httpsPort}`,
      normalizeUrl(input.targetUrl),
    ])
    const route = (await this.listRoutes()).find(
      (candidate) => candidate.httpsPort === input.httpsPort
    )
    if (
      !route ||
      route.targetUrl !== normalizeUrl(input.targetUrl) ||
      route.handlerCount !== 1
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_SERVE_FAILED',
        'Tailscale Serve did not report the expected private preview route.',
        true
      )
    }
    const status = await this.status()
    return { url: `https://${status.dnsName}:${input.httpsPort}/` }
  },

  async revoke(input) {
    if (input.httpsPort === 443) {
      throw new PrivatePreviewError(
        'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH',
        'RUDI Share will not modify the reserved HTTPS 443 route.'
      )
    }
    const route = (await this.listRoutes()).find(
      (candidate) => candidate.httpsPort === input.httpsPort
    )
    if (!route) return
    if (
      route.targetUrl !== normalizeUrl(input.targetUrl) ||
      route.handlerCount !== 1
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH',
        'The live Serve route does not match the saved private preview receipt.'
      )
    }
    await run(['serve', `--https=${input.httpsPort}`, 'off'])
    if (
      (await this.listRoutes()).some(
        (candidate) => candidate.httpsPort === input.httpsPort
      )
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_SERVE_FAILED',
        'Tailscale Serve did not revoke the private preview route.',
        true
      )
    }
  },
  }
}

const defaultTailnetProvider: TailnetProvider = createTailscaleServeProvider()

function chooseHttpsPort(routes: TailnetRoute[]): number {
  const occupied = new Set(routes.map((route) => route.httpsPort))
  for (let port = MIN_HTTPS_PORT; port <= MAX_HTTPS_PORT; port += 1) {
    if (port !== 443 && !occupied.has(port)) return port
  }
  throw new PrivatePreviewError(
    'TAILSCALE_PORT_EXHAUSTED',
    'No private preview HTTPS port is available.',
    true
  )
}

function artifactSummary(
  sourcePath: string,
  manifest: ArtifactManifest
): PrivatePreviewArtifact {
  return {
    sourcePath,
    sha256: manifest.sha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
  }
}

export function createPrivatePreviewService(
  options: CreatePrivatePreviewServiceOptions = {}
) {
  const stateRoot = options.stateRoot ?? DEFAULT_STATE_ROOT
  if (!isAbsolute(stateRoot)) {
    throw new PrivatePreviewError(
      'PREVIEW_STATE_INVALID',
      'Private preview state root must be absolute.'
    )
  }
  const now = options.now ?? (() => new Date())
  const materializeArtifact = options.materializeArtifact ?? materializeStaticArtifact
  const allocatePort = options.allocateLoopbackPort ?? allocateLoopbackPort
  const host = options.host ?? defaultHostController
  const tailscale = options.tailscale ?? defaultTailnetProvider
  const removeArtifact = options.removeArtifact ??
    ((path: string) => rm(path, { recursive: true, force: true }))
  const checkTailnetHealth = options.checkTailnetHealth ??
    ((url, expected) => checkManagedPreviewHealth(url, expected))

  const refreshRecordHealth = async (
    record: PrivatePreviewRecord
  ): Promise<void> => {
    if (record.status === 'revoked') return
    const cleanupRequired =
      record.lifecycle === 'starting' ||
      record.lifecycle === 'cleanup_required'
    if (cleanupRequired) {
      const checkedAt = now().toISOString()
      const failureCode =
        record.lastHealth.failureCode === 'PARTIAL_REVOCATION_CLEANUP_FAILED'
          ? 'PARTIAL_REVOCATION_CLEANUP_FAILED'
          : 'PARTIAL_STARTUP_CLEANUP_FAILED'
      record.lifecycle = 'cleanup_required'
      record.status = 'degraded'
      record.updatedAt = checkedAt
      record.lastHealth = {
        ...record.lastHealth,
        status: 'degraded',
        checkedAt,
        failureCode,
      }
      return
    }
    if (record.hostPid === null) {
      throw new PrivatePreviewError(
        'PREVIEW_STATE_INVALID',
        'Private preview state is invalid.'
      )
    }
    const expected = {
      previewId: record.id,
      artifactSha256: record.artifact.sha256,
      pid: record.hostPid,
    }
    const loopback = await host.check({
      ...expected,
      port: record.loopbackPort,
      url: record.targetUrl,
    })
    let tailnetIdentityFailure: string | null = null
    let trustedTailnetUrl = false
    if (loopback) {
      try {
        const currentTailnet = await tailscale.status()
        if (!currentTailnet.online) {
          tailnetIdentityFailure = 'TAILSCALE_OFFLINE'
        } else if (
          currentTailnet.dnsName !== record.tailnetDnsName ||
          !validTailnetUrl(
            record.url,
            currentTailnet.dnsName,
            record.httpsPort
          )
        ) {
          tailnetIdentityFailure = 'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH'
        } else {
          trustedTailnetUrl = true
        }
      } catch (error) {
        tailnetIdentityFailure = error instanceof PrivatePreviewError
          ? error.code
          : 'TAILSCALE_OFFLINE'
      }
    }
    const tailnet = loopback && trustedTailnetUrl
      ? await checkTailnetHealth(record.url, expected).catch(() => false)
      : false
    const checkedAt = now().toISOString()
    const failureCode = !loopback
        ? 'STALE_PREVIEW_PROCESS'
        : tailnetIdentityFailure
          ? tailnetIdentityFailure
          : !tailnet
            ? 'PREVIEW_HEALTH_CHECK_FAILED'
            : null
    record.status = failureCode ? 'degraded' : 'healthy'
    record.updatedAt = checkedAt
    record.lastHealth = {
      status: record.status,
      loopback,
      tailnet,
      checkedAt,
      failureCode,
    }
  }

  return {
    async publish(input: {
      name: string
      idempotencyKey: string
      artifactPath: string
    }): Promise<PrivatePreviewPublishResult> {
      if (!input.name.trim() || !input.idempotencyKey.trim()) {
        throw new PrivatePreviewError(
          'PREVIEW_STATE_INVALID',
          'Private preview name and idempotency key are required.'
        )
      }
      if (!isAbsolute(input.artifactPath)) {
        throw new PrivatePreviewError(
          'PREVIEW_STATE_INVALID',
          'Private preview artifact_path must be absolute.'
        )
      }
      const previewId = previewIdFor(input.idempotencyKey)
      return withStateLock(stateRoot, async () => {
        const state = await readState(stateRoot)
        const existing = state.previews[previewId]
        if (existing) {
          if (
            existing.name === input.name &&
            existing.artifact.sourcePath === input.artifactPath &&
            existing.status !== 'revoked'
          ) {
            if (existing.lifecycle !== 'active') {
              const cleanupFailureCode =
                existing.lastHealth.failureCode ===
                'PARTIAL_REVOCATION_CLEANUP_FAILED'
                  ? 'PARTIAL_REVOCATION_CLEANUP_FAILED'
                  : 'PARTIAL_STARTUP_CLEANUP_FAILED'
              throw new PrivatePreviewError(
                cleanupFailureCode,
                'Private preview cleanup is required before this publication can be retried.',
                false,
                {
                  previewId: existing.id,
                  access: 'Tailnet private',
                  provider: 'tailscale_serve',
                  failureCode: cleanupFailureCode,
                  httpsPort: existing.httpsPort,
                  targetUrl: existing.targetUrl,
                  hostPid: existing.hostPid,
                  artifactSha256: existing.artifact.sha256,
                  status: existing.lifecycle,
                  supportedAction: 'rudi_share_unpublish',
                }
              )
            }
            await refreshRecordHealth(existing)
            await writeState(stateRoot, state)
            return {
              outcome: 'published',
              access: 'Tailnet private',
              provider: 'tailscale_serve',
              preview: summarize(existing),
            }
          }
          throw new PrivatePreviewError(
            'PREVIEW_IDEMPOTENCY_CONFLICT',
            'The private preview idempotency key is already bound to another operation.'
          )
        }

        const tailnetStatus = await tailscale.status()
        if (!tailnetStatus.online) {
          throw new PrivatePreviewError(
            'TAILSCALE_OFFLINE',
            'Tailscale is installed but this device is offline.',
            true
          )
        }
        const persistedRoutes = Object.values(state.previews)
          .filter((preview) => preview.status !== 'revoked')
          .map((preview) => ({
            httpsPort: preview.httpsPort,
            targetUrl: preview.targetUrl,
          }))
        const httpsPort = chooseHttpsPort([
          ...await tailscale.listRoutes(),
          ...persistedRoutes,
        ])
        const previewDirectory = join(stateRoot, 'previews', previewId)
        const artifactDirectory = join(previewDirectory, 'artifact')
        let materialized: MaterializedStaticArtifact | undefined
        let loopbackPort: number | undefined
        let hostReceipt: HostIdentity | undefined
        let routeReceipt: { url: string } | undefined
        let serveAttempted = false
        let journaled = false
        let record: PrivatePreviewRecord | undefined
        const timestamp = now().toISOString()

        try {
          loopbackPort = await allocatePort()
          materialized = await materializeArtifact(
            input.artifactPath,
            artifactDirectory
          )
          const materializedArtifact = materialized
          const journalHostOwnership = async (startedHost: HostIdentity) => {
            if (
              !validHostIdentity(startedHost) ||
              startedHost.port !== loopbackPort
            ) {
              throw new PrivatePreviewError(
                'PREVIEW_HOST_START_FAILED',
                'The loopback preview host returned an invalid identity.'
              )
            }
            hostReceipt = startedHost
            record = {
              id: previewId,
              name: input.name,
              lifecycle: 'starting',
              status: 'degraded',
              url: `https://${tailnetStatus.dnsName}:${httpsPort}/`,
              httpsPort,
              loopbackPort: startedHost.port,
              hostPid: startedHost.pid,
              targetUrl: startedHost.url,
              tailnetDnsName: tailnetStatus.dnsName,
              artifact: artifactSummary(
                input.artifactPath,
                materializedArtifact.manifest
              ),
              createdAt: timestamp,
              updatedAt: timestamp,
              revokedAt: null,
              lastHealth: {
                status: 'degraded',
                loopback: false,
                tailnet: false,
                checkedAt: timestamp,
                failureCode: 'PREVIEW_STARTING',
              },
              revocationReceipt: null,
            }
            state.previews[previewId] = record
            await writeState(stateRoot, state)
            journaled = true
          }
          const startedHost = await host.start(
            {
              artifactRoot: materializedArtifact.root,
              previewId,
              artifactSha256: materializedArtifact.manifest.sha256,
              port: loopbackPort,
            },
            { beforeDetach: journalHostOwnership }
          )
          if (!journaled) await journalHostOwnership(startedHost)
          const expected = {
            previewId,
            artifactSha256: materializedArtifact.manifest.sha256,
            pid: startedHost.pid,
          }
          if (!(await host.check({ ...startedHost, ...expected }))) {
            throw new PrivatePreviewError(
              'PREVIEW_HEALTH_CHECK_FAILED',
              'The loopback preview host failed its readiness check.',
              true
            )
          }
          serveAttempted = true
          routeReceipt = await tailscale.serve({
            httpsPort,
            targetUrl: startedHost.url,
          })
          if (
            !validTailnetUrl(
              routeReceipt.url,
              tailnetStatus.dnsName,
              httpsPort
            )
          ) {
            throw new PrivatePreviewError(
              'TAILSCALE_SERVE_FAILED',
              'Tailscale Serve returned an invalid private preview URL.'
            )
          }
          if (!(await checkTailnetHealth(routeReceipt.url, expected))) {
            throw new PrivatePreviewError(
              'PREVIEW_HEALTH_CHECK_FAILED',
              'The tailnet-private URL failed its health check.',
              true
            )
          }

          const activeRecord = record
          if (!activeRecord) {
            throw new PrivatePreviewError(
              'PREVIEW_STATE_INVALID',
              'Private preview ownership journal is missing.'
            )
          }
          activeRecord.lifecycle = 'active'
          activeRecord.status = 'healthy'
          activeRecord.url = routeReceipt.url
          activeRecord.updatedAt = now().toISOString()
          activeRecord.lastHealth = {
            status: 'healthy',
            loopback: true,
            tailnet: true,
            checkedAt: activeRecord.updatedAt,
            failureCode: null,
          }
          await writeState(stateRoot, state)
          return {
            outcome: 'published',
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            preview: summarize(activeRecord),
          }
        } catch (error) {
          const failedHostPid =
            error instanceof PrivatePreviewError &&
            error.receipt &&
            Number.isSafeInteger(error.receipt.hostPid) &&
            Number(error.receipt.hostPid) > 0
              ? Number(error.receipt.hostPid)
              : undefined
          const ownedHost = hostReceipt ?? (
            failedHostPid !== undefined && loopbackPort !== undefined
              ? {
                  pid: failedHostPid,
                  port: loopbackPort,
                  url: `http://127.0.0.1:${loopbackPort}/`,
                }
              : undefined
          )
          const cleanupLoopbackPort = ownedHost?.port ?? loopbackPort
          const cleanupTargetUrl = ownedHost?.url ?? (
            cleanupLoopbackPort === undefined
              ? null
              : `http://127.0.0.1:${cleanupLoopbackPort}/`
          )
          let routeRevoked = !serveAttempted
          let hostStopped = ownedHost === undefined
          let staleProcess = false
          if (serveAttempted && ownedHost) {
            try {
              await tailscale.revoke({
                httpsPort,
                targetUrl: ownedHost.url,
              })
              routeRevoked = true
            } catch {
              routeRevoked = false
            }
          }
          if (ownedHost && materialized) {
            try {
              const stopped = await host.stop({
                ...ownedHost,
                previewId,
                artifactSha256: materialized.manifest.sha256,
              })
              hostStopped = stopped.stopped
              staleProcess = stopped.stale
            } catch {
              hostStopped = false
            }
          }
          let artifactRemoved = materialized === undefined
          if (routeRevoked && hostStopped) {
            try {
              await removeArtifact(previewDirectory)
              artifactRemoved = true
            } catch {
              artifactRemoved = false
            }
            if (artifactRemoved && journaled) {
              delete state.previews[previewId]
              await writeState(stateRoot, state)
            }
          }
          const receipt = {
            previewId,
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            failureCode: error instanceof PrivatePreviewError
              ? error.code
              : 'PREVIEW_HOST_START_FAILED',
            routeRevoked,
            hostStopped,
            artifactRemoved,
            staleProcess,
            httpsPort,
            targetUrl: cleanupTargetUrl,
            hostPid: ownedHost?.pid ?? null,
            artifactSha256: materialized?.manifest.sha256 ?? null,
            runtimeRoot: materialized?.root ?? null,
            timestamp: now().toISOString(),
            supportedAction: 'rudi_share_unpublish',
          }
          if (!routeRevoked || !hostStopped || !artifactRemoved) {
            if (
              materialized &&
              cleanupLoopbackPort !== undefined &&
              cleanupTargetUrl !== null
            ) {
              const cleanupRecord = record ?? {
                id: previewId,
                name: input.name,
                lifecycle: 'cleanup_required' as const,
                status: 'degraded' as const,
                url: `https://${tailnetStatus.dnsName}:${httpsPort}/`,
                httpsPort,
                loopbackPort: cleanupLoopbackPort,
                hostPid: ownedHost?.pid ?? null,
                targetUrl: cleanupTargetUrl,
                tailnetDnsName: tailnetStatus.dnsName,
                artifact: artifactSummary(
                  input.artifactPath,
                  materialized.manifest
                ),
                createdAt: timestamp,
                updatedAt: receipt.timestamp,
                revokedAt: null,
                lastHealth: {
                  status: 'degraded' as const,
                  loopback: ownedHost !== undefined && !hostStopped,
                  tailnet: !routeRevoked,
                  checkedAt: receipt.timestamp,
                  failureCode: 'PARTIAL_STARTUP_CLEANUP_FAILED',
                },
                revocationReceipt: null,
              }
              cleanupRecord.lifecycle = 'cleanup_required'
              cleanupRecord.status = 'degraded'
              cleanupRecord.updatedAt = receipt.timestamp
              cleanupRecord.lastHealth = {
                status: 'degraded',
                loopback: ownedHost !== undefined && !hostStopped,
                tailnet: !routeRevoked,
                checkedAt: receipt.timestamp,
                failureCode: 'PARTIAL_STARTUP_CLEANUP_FAILED',
              }
              state.previews[previewId] = cleanupRecord
              await writeState(stateRoot, state)
            }
            throw new PrivatePreviewError(
              'PARTIAL_STARTUP_CLEANUP_FAILED',
              'Private preview startup failed and exact cleanup is incomplete.',
              false,
              receipt
            )
          }
          if (error instanceof PrivatePreviewError) {
            throw new PrivatePreviewError(
              error.code,
              error.message,
              error.retryable,
              receipt
            )
          }
          if (error instanceof ArtifactPackagingError) {
            throw new PrivatePreviewError(
              error.code,
              error.message,
              false,
              receipt
            )
          }
          throw new PrivatePreviewError(
            'PREVIEW_HOST_START_FAILED',
            'Private preview startup failed safely.',
            true,
            receipt
          )
        }
      })
    },

    async get(previewId: string): Promise<PrivatePreviewGetResult> {
      if (!/^private_[a-f0-9]{20}$/.test(previewId)) {
        throw new PrivatePreviewError(
          'PREVIEW_NOT_FOUND',
          'Private preview was not found.'
        )
      }
      return withStateLock(stateRoot, async () => {
        const state = await readState(stateRoot)
        const record = state.previews[previewId]
        if (!record) {
          throw new PrivatePreviewError(
            'PREVIEW_NOT_FOUND',
            'Private preview was not found.'
          )
        }
        if (record.status === 'revoked') {
          return {
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            preview: summarize(record),
          }
        }

        await refreshRecordHealth(record)
        await writeState(stateRoot, state)
        return {
          access: 'Tailnet private',
          provider: 'tailscale_serve',
          preview: summarize(record),
        }
      })
    },

    async unpublish(input: {
      previewId: string
      idempotencyKey: string
    }): Promise<PrivatePreviewUnpublishResult> {
      if (
        !/^private_[a-f0-9]{20}$/.test(input.previewId) ||
        !input.idempotencyKey.trim()
      ) {
        throw new PrivatePreviewError(
          'PREVIEW_NOT_FOUND',
          'Private preview was not found.'
        )
      }
      return withStateLock(stateRoot, async () => {
        const state = await readState(stateRoot)
        const record = state.previews[input.previewId]
        if (!record) {
          throw new PrivatePreviewError(
            'PREVIEW_NOT_FOUND',
            'Private preview was not found.'
          )
        }
        if (record.status === 'revoked') {
          let receipt = record.revocationReceipt
          let cleanupAttempted = false
          if (!receipt) {
            throw new PrivatePreviewError(
              'PREVIEW_STATE_INVALID',
              'Private preview state is invalid.'
            )
          }
          if (!receipt.hostStopped) {
            cleanupAttempted = true
            const stopped = record.hostPid === null
              ? { stopped: true, stale: false }
              : await host.stop({
                  previewId: record.id,
                  artifactSha256: record.artifact.sha256,
                  pid: record.hostPid,
                  port: record.loopbackPort,
                  url: record.targetUrl,
                })
            receipt = {
              ...receipt,
              hostStopped: stopped.stopped,
              staleProcess: stopped.stale,
            }
            record.revocationReceipt = receipt
          }
          if (receipt.hostStopped && !receipt.artifactRemoved) {
            cleanupAttempted = true
            try {
              await removeArtifact(join(stateRoot, 'previews', record.id))
              receipt = { ...receipt, artifactRemoved: true }
            } catch {
              receipt = { ...receipt, artifactRemoved: false }
            }
            record.revocationReceipt = receipt
          }
          record.lastHealth.failureCode = !receipt.hostStopped
            ? 'STALE_PREVIEW_PROCESS'
            : !receipt.artifactRemoved
              ? 'PREVIEW_ARTIFACT_CLEANUP_FAILED'
              : null
          if (cleanupAttempted) {
            const checkedAt = now().toISOString()
            record.updatedAt = checkedAt
            record.lastHealth.checkedAt = checkedAt
          }
          await writeState(stateRoot, state)
          return {
            outcome: 'unpublished',
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            preview: summarize(record),
            receipt,
          }
        }

        let routeRevoked = record.hostPid === null
        let routeFailureCode: PrivatePreviewErrorCode | null = null
        if (record.hostPid !== null) {
          try {
            await tailscale.revoke({
              httpsPort: record.httpsPort,
              targetUrl: record.targetUrl,
            })
            routeRevoked = true
          } catch (error) {
            routeFailureCode = error instanceof PrivatePreviewError
              ? error.code
              : 'TAILSCALE_SERVE_FAILED'
          }
        }
        let stopped = { stopped: record.hostPid === null, stale: false }
        if (record.hostPid !== null) {
          try {
            stopped = await host.stop({
              previewId: record.id,
              artifactSha256: record.artifact.sha256,
              pid: record.hostPid,
              port: record.loopbackPort,
              url: record.targetUrl,
            })
          } catch {
            stopped = { stopped: false, stale: true }
          }
        }
        const revokedAt = now().toISOString()
        let artifactRemoved = false
        if (stopped.stopped) {
          try {
            await removeArtifact(join(stateRoot, 'previews', record.id))
            artifactRemoved = true
          } catch {
            artifactRemoved = false
          }
        }
        if (!routeRevoked || !stopped.stopped) {
          record.status = 'degraded'
          record.lifecycle = 'cleanup_required'
          record.revokedAt = null
          record.updatedAt = revokedAt
          record.revocationReceipt = null
          record.lastHealth = {
            status: 'degraded',
            loopback: !stopped.stopped,
            tailnet: !routeRevoked,
            checkedAt: revokedAt,
            failureCode: 'PARTIAL_REVOCATION_CLEANUP_FAILED',
          }
          await writeState(stateRoot, state)
          throw new PrivatePreviewError(
            'PARTIAL_REVOCATION_CLEANUP_FAILED',
            'Private preview revocation is incomplete; retry the exact unpublish operation.',
            false,
            {
              previewId: record.id,
              access: 'Tailnet private',
              provider: 'tailscale_serve',
              failureCode: routeFailureCode ?? 'STALE_PREVIEW_PROCESS',
              routeRevoked,
              hostStopped: stopped.stopped,
              artifactRemoved,
              staleProcess: stopped.stale,
              httpsPort: record.httpsPort,
              targetUrl: record.targetUrl,
              hostPid: record.hostPid,
              artifactSha256: record.artifact.sha256,
              runtimeRoot: join(stateRoot, 'previews', record.id),
              timestamp: revokedAt,
              supportedAction: 'rudi_share_unpublish',
            }
          )
        }
        record.status = 'revoked'
        record.lifecycle = 'revoked'
        record.revokedAt = revokedAt
        record.updatedAt = revokedAt
        record.lastHealth = {
          status: 'revoked',
          loopback: false,
          tailnet: false,
          checkedAt: revokedAt,
          failureCode: !stopped.stopped
            ? 'STALE_PREVIEW_PROCESS'
            : !artifactRemoved
              ? 'PREVIEW_ARTIFACT_CLEANUP_FAILED'
              : null,
        }
        const receipt = {
          routeRevoked: true,
          hostStopped: stopped.stopped,
          artifactRemoved,
          staleProcess: stopped.stale,
          revokedAt,
        }
        record.revocationReceipt = receipt
        await writeState(stateRoot, state)
        return {
          outcome: 'unpublished',
          access: 'Tailnet private',
          provider: 'tailscale_serve',
          preview: summarize(record),
          receipt,
        }
      })
    },
  }
}
