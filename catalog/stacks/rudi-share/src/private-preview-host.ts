import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type HostCheckInput,
  type HostIdentity,
  type PreviewHostController,
  PrivatePreviewError,
  healthUrl,
  isRecord,
  processExists,
  runtimeEnvironment,
  validHostIdentity,
} from './private-preview-contract.js'

export async function allocateLoopbackPort(): Promise<number> {
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

export const defaultHostController: PreviewHostController = createManagedHostController()
