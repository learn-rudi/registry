import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const manifest = {
  sha256: 'b'.repeat(64),
  fileCount: 2,
  totalBytes: 42,
  files: [
    { path: 'assets/app.js', bytes: 20 },
    { path: 'index.html', bytes: 22 },
  ],
}

test('private preview cleans an exact Serve route when startup fails after provider mutation', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-partial-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const createService = (privateModule as unknown as Record<string, unknown>)[
    'createPrivatePreviewService'
  ] as (options: Record<string, unknown>) => {
    publish(input: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  const PreviewError = (privateModule as unknown as Record<string, unknown>)[
    'PrivatePreviewError'
  ] as new (
    code: string,
    message: string,
    retryable?: boolean
  ) => Error & { code: string; receipt?: Record<string, unknown> }
  let routeCreated = false
  let revokeCalls = 0
  let stopCalls = 0
  const service = createService({
    stateRoot,
    allocateLoopbackPort: async () => 41_003,
    materializeArtifact: async (_source: string, destination: string) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Partial</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_212, port: 41_003, url: 'http://127.0.0.1:41003/' }
      },
      async check() {
        return true
      },
      async stop() {
        stopCalls += 1
        return { stopped: true, stale: false }
      },
    },
    tailscale: {
      async status() {
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return [{ httpsPort: 443, targetUrl: 'http://127.0.0.1:39999/' }]
      },
      async serve() {
        routeCreated = true
        throw new PreviewError(
          'TAILSCALE_SERVE_FAILED',
          'Serve changed state but verification failed.',
          true
        )
      },
      async revoke(input: Record<string, unknown>) {
        assert.deepEqual(input, {
          httpsPort: 8443,
          targetUrl: 'http://127.0.0.1:41003/',
        })
        revokeCalls += 1
        routeCreated = false
      },
    },
    checkTailnetHealth: async () => true,
  })

  await assert.rejects(
    service.publish({
      name: 'Partial startup',
      idempotencyKey: 'private-preview-partial',
      artifactPath: '/tmp/partial-artifact',
    }),
    (error: unknown) => {
      assert.ok(error instanceof PreviewError)
      assert.equal(error.code, 'TAILSCALE_SERVE_FAILED')
      assert.equal(error.receipt?.routeRevoked, true)
      assert.equal(error.receipt?.hostStopped, true)
      return true
    }
  )
  assert.equal(routeCreated, false)
  assert.equal(revokeCalls, 1)
  assert.equal(stopCalls, 1)
})

test('startup cleanup journals a failed screened artifact deletion for retry', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-startup-artifact-cleanup-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const PreviewError = privateModule.PrivatePreviewError
  let removeCalls = 0
  let routeActive = false
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_024,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Startup cleanup</h1>')
      return { root: destination, manifest }
    },
    removeArtifact: async (path) => {
      removeCalls += 1
      if (removeCalls === 1) {
        throw new Error('injected startup artifact cleanup failure')
      }
      await rm(path, { recursive: true, force: true })
    },
    host: {
      async start() {
        return { pid: 43_234, port: 41_024, url: 'http://127.0.0.1:41024/' }
      },
      async check() {
        return true
      },
      async stop() {
        return { stopped: true, stale: false }
      },
    },
    tailscale: {
      async status() {
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return routeActive
          ? [{ httpsPort: 8443, targetUrl: 'http://127.0.0.1:41024/', handlerCount: 1 }]
          : []
      },
      async serve() {
        routeActive = true
        throw new PreviewError(
          'TAILSCALE_SERVE_FAILED',
          'Serve changed state but verification failed.',
          true
        )
      },
      async revoke() {
        routeActive = false
      },
    },
    checkTailnetHealth: async () => true,
  })

  let previewId = ''
  await assert.rejects(
    service.publish({
      name: 'Startup artifact cleanup',
      idempotencyKey: 'private-preview-startup-artifact-cleanup',
      artifactPath: '/tmp/startup-artifact-cleanup',
    }),
    (error: unknown) => {
      assert.ok(error instanceof PreviewError)
      assert.equal(error.code, 'PARTIAL_STARTUP_CLEANUP_FAILED')
      assert.equal(error.receipt?.routeRevoked, true)
      assert.equal(error.receipt?.hostStopped, true)
      assert.equal(error.receipt?.artifactRemoved, false)
      previewId = String(error.receipt?.previewId)
      return true
    }
  )
  const persisted = JSON.parse(
    await readFile(join(stateRoot, 'private-previews.json'), 'utf8')
  )
  assert.equal(persisted.previews[previewId].lifecycle, 'cleanup_required')
  assert.equal(
    persisted.previews[previewId].lastHealth.failureCode,
    'PARTIAL_STARTUP_CLEANUP_FAILED'
  )

  const retried = await service.unpublish({
    previewId,
    idempotencyKey: 'private-preview-startup-artifact-cleanup-retry',
  })
  assert.equal(retried.preview.status, 'revoked')
  assert.equal(retried.receipt.routeRevoked, true)
  assert.equal(retried.receipt.hostStopped, true)
  assert.equal(retried.receipt.artifactRemoved, true)
  assert.equal(removeCalls, 2)
})

test('pre-host startup cleanup journals an unremoved screened artifact without process ownership', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-prehost-artifact-cleanup-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const PreviewError = privateModule.PrivatePreviewError
  let removeCalls = 0
  let revokeCalls = 0
  let stopCalls = 0
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_025,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Pre-host cleanup</h1>')
      return { root: destination, manifest }
    },
    removeArtifact: async (path) => {
      removeCalls += 1
      if (removeCalls === 1) {
        throw new Error('injected pre-host artifact cleanup failure')
      }
      await rm(path, { recursive: true, force: true })
    },
    host: {
      async start() {
        throw new PreviewError(
          'PREVIEW_HOST_START_FAILED',
          'The host failed before returning process ownership.',
          true
        )
      },
      async check() {
        return false
      },
      async stop() {
        stopCalls += 1
        return { stopped: true, stale: false }
      },
    },
    tailscale: {
      async status() {
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return []
      },
      async serve() {
        throw new Error('Serve must not run before host ownership exists.')
      },
      async revoke() {
        revokeCalls += 1
      },
    },
    checkTailnetHealth: async () => false,
  })

  let previewId = ''
  await assert.rejects(
    service.publish({
      name: 'Pre-host artifact cleanup',
      idempotencyKey: 'private-preview-prehost-artifact-cleanup',
      artifactPath: '/tmp/prehost-artifact-cleanup',
    }),
    (error: unknown) => {
      assert.ok(error instanceof PreviewError)
      assert.equal(error.code, 'PARTIAL_STARTUP_CLEANUP_FAILED')
      assert.equal(error.receipt?.routeRevoked, true)
      assert.equal(error.receipt?.hostStopped, true)
      assert.equal(error.receipt?.artifactRemoved, false)
      assert.equal(error.receipt?.hostPid, null)
      previewId = String(error.receipt?.previewId)
      return true
    }
  )
  const persisted = JSON.parse(
    await readFile(join(stateRoot, 'private-previews.json'), 'utf8')
  )
  assert.equal(persisted.previews[previewId].lifecycle, 'cleanup_required')
  assert.equal(persisted.previews[previewId].hostPid, null)

  const retried = await service.unpublish({
    previewId,
    idempotencyKey: 'private-preview-prehost-artifact-cleanup-retry',
  })
  assert.equal(retried.preview.status, 'revoked')
  assert.equal(retried.receipt.artifactRemoved, true)
  assert.equal(removeCalls, 2)
  assert.equal(revokeCalls, 0)
  assert.equal(stopCalls, 0)
})

test('failed partial cleanup persists exact ownership for later supported revocation', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-cleanup-journal-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let cleanupCanFinish = false
  let routeActive = false
  let hostActive = true
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_013,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Journal</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_223, port: 41_013, url: 'http://127.0.0.1:41013/' }
      },
      async check() {
        return hostActive
      },
      async stop() {
        if (!cleanupCanFinish) return { stopped: false, stale: false }
        hostActive = false
        return { stopped: true, stale: false }
      },
    },
    tailscale: {
      async status() {
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return routeActive
          ? [{ httpsPort: 8443, targetUrl: 'http://127.0.0.1:41013/', handlerCount: 1 }]
          : []
      },
      async serve() {
        routeActive = true
        throw new privateModule.PrivatePreviewError(
          'TAILSCALE_SERVE_FAILED',
          'Serve mutated but verification failed.',
          true
        )
      },
      async revoke() {
        if (!cleanupCanFinish) throw new Error('temporary revoke failure')
        routeActive = false
      },
    },
    checkTailnetHealth: async () => routeActive && hostActive,
  })

  let receipt: Record<string, unknown> | undefined
  await assert.rejects(
    service.publish({
      name: 'Cleanup journal',
      idempotencyKey: 'private-preview-cleanup-journal',
      artifactPath: '/tmp/cleanup-journal-artifact',
    }),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PARTIAL_STARTUP_CLEANUP_FAILED')
      receipt = error.receipt
      assert.equal(receipt?.httpsPort, 8443)
      assert.equal(receipt?.targetUrl, 'http://127.0.0.1:41013/')
      assert.equal(receipt?.hostPid, 43_223)
      assert.equal(receipt?.artifactSha256, manifest.sha256)
      return true
    }
  )
  const previewId = String(receipt?.previewId)
  await assert.rejects(
    service.publish({
      name: 'Cleanup journal',
      idempotencyKey: 'private-preview-cleanup-journal',
      artifactPath: '/tmp/cleanup-journal-artifact',
    }),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PARTIAL_STARTUP_CLEANUP_FAILED')
      assert.equal(error.receipt?.previewId, previewId)
      return true
    }
  )
  const pending = await service.get(previewId)
  assert.equal(pending.preview.status, 'degraded')
  assert.equal(
    pending.preview.health.failureCode,
    'PARTIAL_STARTUP_CLEANUP_FAILED'
  )

  cleanupCanFinish = true
  const revoked = await service.unpublish({
    previewId,
    idempotencyKey: 'cleanup-journal-revoke',
  })
  assert.equal(revoked.receipt.routeRevoked, true)
  assert.equal(revoked.receipt.hostStopped, true)
  assert.equal(routeActive, false)
  assert.equal(hostActive, false)
})

test('publish retry reports a durable starting journal instead of replaying published', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-starting-retry-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let serveCalls = 0
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_016,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Starting</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_225, port: 41_016, url: 'http://127.0.0.1:41016/' }
      },
      async check() {
        return true
      },
      async stop() {
        return { stopped: true, stale: false }
      },
    },
    tailscale: {
      async status() {
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return []
      },
      async serve() {
        serveCalls += 1
        return { url: 'https://rudi.example.ts.net:8443/' }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => true,
  })
  const input = {
    name: 'Starting retry',
    idempotencyKey: 'private-preview-starting-retry',
    artifactPath: '/tmp/starting-retry-artifact',
  }
  const published = await service.publish(input)
  const statePath = join(stateRoot, 'private-previews.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const record = state.previews[published.preview.id]
  record.lifecycle = 'starting'
  record.status = 'degraded'
  record.lastHealth = {
    status: 'degraded',
    loopback: true,
    tailnet: false,
    checkedAt: record.updatedAt,
    failureCode: 'PREVIEW_STARTING',
  }
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)

  await assert.rejects(
    service.publish(input),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PARTIAL_STARTUP_CLEANUP_FAILED')
      assert.equal(error.receipt?.previewId, published.preview.id)
      return true
    }
  )
  assert.equal(serveCalls, 1)
})
