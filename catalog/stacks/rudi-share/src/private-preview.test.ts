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

test('private preview publishes a validated snapshot on an unused non-443 tailnet endpoint', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-private-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const effects: Array<Record<string, unknown>> = []

  const privateModule = await import('./private-preview.js')
  const createService = (privateModule as unknown as Record<string, unknown>)[
    'createPrivatePreviewService'
  ]
  assert.equal(typeof createService, 'function')
  const service = (createService as (options: Record<string, unknown>) => {
    publish(input: Record<string, unknown>): Promise<Record<string, unknown>>
  })({
    stateRoot,
    now: () => new Date('2026-08-29T14:00:00.000Z'),
    allocateLoopbackPort: async () => 41_001,
    materializeArtifact: async (_source: string, destination: string) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Private</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start(input: Record<string, unknown>) {
        effects.push({ effect: 'host.start', ...input })
        return { pid: 43_210, port: 41_001, url: 'http://127.0.0.1:41001/' }
      },
      async check() {
        return true
      },
      async stop() {
        effects.push({ effect: 'host.stop' })
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
      async serve(input: Record<string, unknown>) {
        effects.push({ effect: 'tailscale.serve', ...input })
        return { url: `https://rudi.example.ts.net:${input.httpsPort as number}/` }
      },
      async revoke(input: Record<string, unknown>) {
        effects.push({ effect: 'tailscale.revoke', ...input })
      },
    },
    checkTailnetHealth: async () => true,
  })

  const result = await service.publish({
    name: 'Private mobile preview',
    idempotencyKey: 'private-preview-happy-path',
    artifactPath: '/tmp/prepared-static-artifact',
  })

  assert.equal(result.outcome, 'published')
  assert.equal(result.access, 'Tailnet private')
  assert.equal(result.provider, 'tailscale_serve')
  const preview = result.preview as Record<string, unknown>
  assert.match(String(preview.id), /^private_[a-f0-9]{20}$/)
  assert.equal(preview.status, 'healthy')
  assert.equal(preview.url, 'https://rudi.example.ts.net:8443/')
  assert.deepEqual(preview.artifact, {
    sourcePath: '/tmp/prepared-static-artifact',
    sha256: manifest.sha256,
    fileCount: 2,
    totalBytes: 42,
  })
  assert.deepEqual(
    effects.filter((effect) => effect.effect === 'tailscale.serve'),
    [
      {
        effect: 'tailscale.serve',
        httpsPort: 8443,
        targetUrl: 'http://127.0.0.1:41001/',
      },
    ]
  )
  assert.equal(effects.some((effect) => effect.httpsPort === 443), false)
})

test('private preview get checks health and unpublish revokes only the owned route and host', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-revoke-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const routes = [
    { httpsPort: 443, targetUrl: 'http://127.0.0.1:39999/', handlerCount: 1 },
  ]
  let hostAlive = true
  const revocations: Array<Record<string, unknown>> = []
  let clockTick = 0

  const privateModule = await import('./private-preview.js')
  const createService = (privateModule as unknown as Record<string, unknown>)[
    'createPrivatePreviewService'
  ] as (options: Record<string, unknown>) => {
    publish(input: Record<string, unknown>): Promise<Record<string, unknown>>
    get(previewId: string): Promise<Record<string, unknown>>
    unpublish(input: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  const service = createService({
    stateRoot,
    now: () => new Date(Date.UTC(2026, 7, 29, 15, 0, clockTick++)),
    allocateLoopbackPort: async () => 41_002,
    materializeArtifact: async (_source: string, destination: string) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Revoke</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_211, port: 41_002, url: 'http://127.0.0.1:41002/' }
      },
      async check() {
        return hostAlive
      },
      async stop(input: Record<string, unknown>) {
        assert.equal(input.pid, 43_211)
        hostAlive = false
        return { stopped: true, stale: false }
      },
    },
    tailscale: {
      async status() {
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return routes
      },
      async serve(input: { httpsPort: number; targetUrl: string }) {
        routes.push({ ...input, handlerCount: 1 })
        return { url: `https://rudi.example.ts.net:${input.httpsPort}/` }
      },
      async revoke(input: Record<string, unknown>) {
        revocations.push(input)
        const index = routes.findIndex(
          (route) => route.httpsPort === input.httpsPort &&
            route.targetUrl === input.targetUrl
        )
        assert.notEqual(index, -1)
        routes.splice(index, 1)
      },
    },
    checkTailnetHealth: async () => hostAlive && routes.some((route) => route.httpsPort === 8443),
  })

  const published = await service.publish({
    name: 'Revocable preview',
    idempotencyKey: 'private-preview-revoke',
    artifactPath: '/tmp/revocable-artifact',
  })
  const previewId = String((published.preview as Record<string, unknown>).id)
  const status = await service.get(previewId)
  assert.equal((status.preview as Record<string, unknown>).status, 'healthy')

  const unpublished = await service.unpublish({
    previewId,
    idempotencyKey: 'private-preview-revoke-operation',
  })
  assert.equal(unpublished.outcome, 'unpublished')
  assert.deepEqual(revocations, [
    { httpsPort: 8443, targetUrl: 'http://127.0.0.1:41002/' },
  ])
  assert.deepEqual(routes, [
    { httpsPort: 443, targetUrl: 'http://127.0.0.1:39999/', handlerCount: 1 },
  ])
  assert.deepEqual(unpublished.receipt, {
    routeRevoked: true,
    hostStopped: true,
    artifactRemoved: true,
    staleProcess: false,
    revokedAt: '2026-08-29T15:00:03.000Z',
  })
  const revokedStatus = await service.get(previewId)
  assert.equal((revokedStatus.preview as Record<string, unknown>).status, 'revoked')
})

test('unpublish stops the managed host even when exact route revocation fails', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-independent-revoke-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const PreviewError = privateModule.PrivatePreviewError
  let routeCanRevoke = false
  let hostActive = true
  let stopCalls = 0
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_021,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Independent</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_231, port: 41_021, url: 'http://127.0.0.1:41021/' }
      },
      async check() {
        return hostActive
      },
      async stop() {
        stopCalls += 1
        hostActive = false
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
      async serve(input) {
        return { url: `https://rudi.example.ts.net:${input.httpsPort}/` }
      },
      async revoke() {
        if (!routeCanRevoke) {
          throw new PreviewError(
            'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH',
            'The live route no longer has exact ownership.'
          )
        }
      },
    },
    checkTailnetHealth: async () => true,
  })
  const published = await service.publish({
    name: 'Independent revoke cleanup',
    idempotencyKey: 'private-preview-independent-revoke',
    artifactPath: '/tmp/independent-revoke-artifact',
  })

  await assert.rejects(
    service.unpublish({
      previewId: published.preview.id,
      idempotencyKey: 'private-preview-independent-revoke-first',
    }),
    (error: unknown) => {
      assert.ok(error instanceof PreviewError)
      assert.equal(error.code, 'PARTIAL_REVOCATION_CLEANUP_FAILED')
      assert.equal(error.receipt?.failureCode, 'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH')
      assert.equal(error.receipt?.routeRevoked, false)
      assert.equal(error.receipt?.hostStopped, true)
      assert.equal(error.receipt?.artifactRemoved, true)
      assert.equal(error.receipt?.supportedAction, 'rudi_share_unpublish')
      return true
    }
  )
  assert.equal(hostActive, false)
  assert.equal(stopCalls, 1)
  const persisted = JSON.parse(
    await readFile(join(stateRoot, 'private-previews.json'), 'utf8')
  )
  assert.equal(persisted.previews[published.preview.id].lifecycle, 'cleanup_required')
  assert.equal(
    persisted.previews[published.preview.id].lastHealth.failureCode,
    'PARTIAL_REVOCATION_CLEANUP_FAILED'
  )
  const pending = await service.get(published.preview.id)
  assert.equal(
    pending.preview.health.failureCode,
    'PARTIAL_REVOCATION_CLEANUP_FAILED'
  )
  await assert.rejects(
    service.publish({
      name: 'Independent revoke cleanup',
      idempotencyKey: 'private-preview-independent-revoke',
      artifactPath: '/tmp/independent-revoke-artifact',
    }),
    (error: unknown) => {
      assert.ok(error instanceof PreviewError)
      assert.equal(error.code, 'PARTIAL_REVOCATION_CLEANUP_FAILED')
      assert.equal(
        error.receipt?.failureCode,
        'PARTIAL_REVOCATION_CLEANUP_FAILED'
      )
      return true
    }
  )

  routeCanRevoke = true
  const retried = await service.unpublish({
    previewId: published.preview.id,
    idempotencyKey: 'private-preview-independent-revoke-second',
  })
  assert.equal(retried.receipt.routeRevoked, true)
  assert.equal(retried.receipt.hostStopped, true)
  assert.equal(retried.receipt.artifactRemoved, true)
  assert.equal(retried.preview.status, 'revoked')
  assert.equal(stopCalls, 2)
})

test('repeated unpublish retries and persists incomplete exact host cleanup', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-revoke-retry-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const PreviewError = privateModule.PrivatePreviewError
  let stopCalls = 0
  let revokeCalls = 0
  let routeActive = true
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_012,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Retry</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_222, port: 41_012, url: 'http://127.0.0.1:41012/' }
      },
      async check() {
        return true
      },
      async stop() {
        stopCalls += 1
        return { stopped: stopCalls > 1, stale: false }
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
        return { url: 'https://rudi.example.ts.net:8443/' }
      },
      async revoke() {
        if (routeActive) {
          revokeCalls += 1
          routeActive = false
        }
      },
    },
    checkTailnetHealth: async () => true,
  })
  const published = await service.publish({
    name: 'Retry cleanup',
    idempotencyKey: 'private-preview-revoke-retry',
    artifactPath: '/tmp/retry-artifact',
  })

  await assert.rejects(
    service.unpublish({
      previewId: published.preview.id,
      idempotencyKey: 'revoke-retry-first',
    }),
    (error: unknown) => {
      assert.ok(error instanceof PreviewError)
      assert.equal(error.code, 'PARTIAL_REVOCATION_CLEANUP_FAILED')
      assert.equal(error.receipt?.routeRevoked, true)
      assert.equal(error.receipt?.hostStopped, false)
      assert.equal(error.receipt?.artifactRemoved, false)
      return true
    }
  )
  assert.equal(stopCalls, 1)
  assert.equal(revokeCalls, 1)

  const second = await service.unpublish({
    previewId: published.preview.id,
    idempotencyKey: 'revoke-retry-second',
  })
  assert.equal(second.receipt.hostStopped, true)
  assert.equal(stopCalls, 2)
  assert.equal(revokeCalls, 1)

  const third = await service.unpublish({
    previewId: published.preview.id,
    idempotencyKey: 'revoke-retry-third',
  })
  assert.deepEqual(third.receipt, second.receipt)
  assert.equal(stopCalls, 2)
})

test('repeated unpublish retries and persists incomplete artifact cleanup', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-artifact-cleanup-retry-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let targetPreviewId = ''
  let targetRemoveCalls = 0
  let targetStopCalls = 0
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_020,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Artifact retry</h1>')
      return { root: destination, manifest }
    },
    removeArtifact: async (path) => {
      if (path.endsWith(targetPreviewId)) {
        targetRemoveCalls += 1
        if (targetRemoveCalls === 1) {
          throw new Error('injected artifact cleanup failure')
        }
      }
      await rm(path, { recursive: true, force: true })
    },
    host: {
      async start() {
        return { pid: 43_230, port: 41_020, url: 'http://127.0.0.1:41020/' }
      },
      async check() {
        return true
      },
      async stop(input) {
        if (input.previewId === targetPreviewId) targetStopCalls += 1
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
        return { url: 'https://rudi.example.ts.net:8443/' }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => true,
  })
  const published = await service.publish({
    name: 'Retry artifact cleanup',
    idempotencyKey: 'private-preview-artifact-cleanup-retry',
    artifactPath: '/tmp/artifact-cleanup-retry',
  })
  targetPreviewId = published.preview.id

  const first = await service.unpublish({
    previewId: published.preview.id,
    idempotencyKey: 'artifact-cleanup-retry-first',
  })
  assert.equal(first.receipt.hostStopped, true)
  assert.equal(first.receipt.artifactRemoved, false)
  assert.equal(first.preview.health.failureCode, 'PREVIEW_ARTIFACT_CLEANUP_FAILED')
  assert.equal(targetRemoveCalls, 1)
  assert.equal(targetStopCalls, 1)

  const persisted = JSON.parse(
    await readFile(join(stateRoot, 'private-previews.json'), 'utf8')
  )
  assert.equal(
    persisted.previews[published.preview.id].revocationReceipt.artifactRemoved,
    false
  )

  for (let index = 0; index < 129; index += 1) {
    const complete = await service.publish({
      name: `Later complete cleanup ${index}`,
      idempotencyKey: `private-preview-later-cleanup-${index}`,
      artifactPath: `/tmp/later-cleanup-artifact-${index}`,
    })
    await service.unpublish({
      previewId: complete.preview.id,
      idempotencyKey: `private-preview-later-cleanup-revoke-${index}`,
    })
  }
  const retained = JSON.parse(
    await readFile(join(stateRoot, 'private-previews.json'), 'utf8')
  )
  assert.equal(
    retained.previews[published.preview.id].revocationReceipt.artifactRemoved,
    false
  )

  const second = await service.unpublish({
    previewId: published.preview.id,
    idempotencyKey: 'artifact-cleanup-retry-second',
  })
  assert.equal(second.receipt.artifactRemoved, true)
  assert.equal(second.preview.health.failureCode, null)
  assert.equal(targetRemoveCalls, 2)
  assert.equal(targetStopCalls, 1)

  const third = await service.unpublish({
    previewId: published.preview.id,
    idempotencyKey: 'artifact-cleanup-retry-third',
  })
  assert.deepEqual(third.receipt, second.receipt)
  assert.equal(targetRemoveCalls, 2)
  assert.equal(targetStopCalls, 1)
})

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

test('Tailscale adapter uses only tailnet Serve and revokes the exact non-443 endpoint', async () => {
  const privateModule = await import('./private-preview.js')
  const createProvider = (privateModule as unknown as Record<string, unknown>)[
    'createTailscaleServeProvider'
  ]
  assert.equal(typeof createProvider, 'function')
  const commands: string[][] = []
  let privateRouteEnabled = false
  const statusBody = JSON.stringify({
    BackendState: 'Running',
    Self: { Online: true, DNSName: 'rudi.example.ts.net.' },
  })
  const serveStatus = () => JSON.stringify({
    TCP: privateRouteEnabled
      ? { '443': { HTTPS: true }, '8443': { HTTPS: true } }
      : { '443': { HTTPS: true } },
    Web: privateRouteEnabled
      ? {
          'rudi.example.ts.net:443': {
            Handlers: { '/': { Proxy: 'http://127.0.0.1:39999' } },
          },
          'rudi.example.ts.net:8443': {
            Handlers: { '/': { Proxy: 'http://127.0.0.1:41004' } },
          },
        }
      : {
          'rudi.example.ts.net:443': {
            Handlers: { '/': { Proxy: 'http://127.0.0.1:39999' } },
          },
        },
  })
  const provider = (createProvider as (options: Record<string, unknown>) => {
    listRoutes(): Promise<Array<Record<string, unknown>>>
    serve(input: Record<string, unknown>): Promise<Record<string, unknown>>
    revoke(input: Record<string, unknown>): Promise<void>
  })({
    run: async (args: string[]) => {
      commands.push(args)
      if (args[0] === 'status') return { stdout: statusBody, stderr: '' }
      if (args.join(' ') === 'serve status --json') {
        return { stdout: serveStatus(), stderr: '' }
      }
      if (args.includes('--bg')) {
        privateRouteEnabled = true
        return { stdout: 'Available within your tailnet.', stderr: '' }
      }
      if (args.at(-1) === 'off') {
        privateRouteEnabled = false
        return { stdout: '', stderr: '' }
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`)
    },
  })

  assert.deepEqual(await provider.listRoutes(), [
    {
      httpsPort: 443,
      targetUrl: 'http://127.0.0.1:39999/',
      handlerCount: 1,
    },
  ])
  const served = await provider.serve({
    httpsPort: 8443,
    targetUrl: 'http://127.0.0.1:41004/',
  })
  assert.equal(served.url, 'https://rudi.example.ts.net:8443/')
  await provider.revoke({
    httpsPort: 8443,
    targetUrl: 'http://127.0.0.1:41004/',
  })

  assert.equal(privateRouteEnabled, false)
  assert.ok(commands.some((args) => args.join(' ') ===
    'serve --bg --https=8443 http://127.0.0.1:41004/'))
  assert.ok(commands.some((args) => args.join(' ') ===
    'serve --https=8443 off'))
  assert.equal(commands.flat().includes('funnel'), false)
  assert.equal(commands.flat().includes('--yes'), false)
  assert.equal(commands.some((args) => args.includes('--https=443')), false)
})

test('Tailscale adapter reserves foreground service and Funnel-owned ports', async () => {
  const privateModule = await import('./private-preview.js')
  const provider = privateModule.createTailscaleServeProvider({
    run: async (args: string[]) => {
      assert.deepEqual(args, ['serve', 'status', '--json'])
      return {
        stdout: JSON.stringify({
          TCP: { '443': { HTTPS: true } },
          Web: {
            'rudi.example.ts.net:443': {
              Handlers: { '/': { Proxy: 'http://127.0.0.1:39999' } },
            },
          },
          AllowFunnel: { 'rudi.example.ts.net:8444': true },
          Foreground: {
            session: {
              TCP: { '8443': { HTTPS: true } },
              Web: {
                'rudi.example.ts.net:8443': {
                  Handlers: { '/': { Proxy: 'http://127.0.0.1:41043' } },
                },
              },
            },
          },
          Services: {
            'svc:existing-preview': {
              TCP: { '8445': { HTTPS: true } },
              Web: {
                'existing-preview.example.ts.net:8445': {
                  Handlers: { '/': { Proxy: 'http://127.0.0.1:41045' } },
                },
              },
            },
          },
        }),
        stderr: '',
      }
    },
  })

  assert.deepEqual(
    (await provider.listRoutes()).map((route) => route.httpsPort),
    [443, 8443, 8444, 8445]
  )
})

test('Tailscale adapter preserves a mismatched live route without issuing revocation', async () => {
  const privateModule = await import('./private-preview.js')
  const commands: string[][] = []
  const provider = privateModule.createTailscaleServeProvider({
    run: async (args: string[]) => {
      commands.push(args)
      assert.deepEqual(args, ['serve', 'status', '--json'])
      return {
        stdout: JSON.stringify({
          TCP: { '8443': { HTTPS: true } },
          Web: {
            'rudi.example.ts.net:8443': {
              Handlers: { '/': { Proxy: 'http://127.0.0.1:49999' } },
            },
          },
        }),
        stderr: '',
      }
    },
  })

  await assert.rejects(
    provider.revoke({
      httpsPort: 8443,
      targetUrl: 'http://127.0.0.1:41004/',
    }),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH')
      return true
    }
  )
  assert.deepEqual(commands, [['serve', 'status', '--json']])
})

test('private preview preserves precise static artifact rejection codes without starting a host or route', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-invalid-'))
  const artifactPath = join(stateRoot, 'invalid-artifact')
  await mkdir(artifactPath)
  await writeFile(join(artifactPath, 'app.js'), 'window.ready = true')
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const createService = (privateModule as unknown as Record<string, unknown>)[
    'createPrivatePreviewService'
  ] as (options: Record<string, unknown>) => {
    publish(input: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  let hostStarts = 0
  let serveCalls = 0
  const service = createService({
    stateRoot: join(stateRoot, 'state'),
    host: {
      async start() {
        hostStarts += 1
        throw new Error('must not start')
      },
      async check() {
        return false
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
        throw new Error('must not serve')
      },
      async revoke() {},
    },
  })

  await assert.rejects(
    service.publish({
      name: 'Invalid artifact',
      idempotencyKey: 'private-preview-invalid-artifact',
      artifactPath,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'code' in error)
      assert.equal(error.code, 'MISSING_INDEX')
      return true
    }
  )
  assert.equal(hostStarts, 0)
  assert.equal(serveCalls, 0)
})

test('private preview reports offline Tailscale before artifact or host effects', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-offline-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const createService = privateModule.createPrivatePreviewService
  let materializations = 0
  let hostStarts = 0
  const service = createService({
    stateRoot,
    materializeArtifact: async () => {
      materializations += 1
      throw new Error('must not materialize')
    },
    host: {
      async start() {
        hostStarts += 1
        throw new Error('must not start')
      },
      async check() {
        return false
      },
      async stop() {
        return { stopped: true, stale: false }
      },
    },
    tailscale: {
      async status() {
        throw new privateModule.PrivatePreviewError(
          'TAILSCALE_OFFLINE',
          'Tailscale is offline.',
          true
        )
      },
      async listRoutes() {
        return []
      },
      async serve() {
        throw new Error('must not serve')
      },
      async revoke() {},
    },
  })

  await assert.rejects(
    service.publish({
      name: 'Offline preview',
      idempotencyKey: 'private-preview-offline',
      artifactPath: '/tmp/offline-artifact',
    }),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'TAILSCALE_OFFLINE')
      assert.equal(error.retryable, true)
      return true
    }
  )
  assert.equal(materializations, 0)
  assert.equal(hostStarts, 0)
})

test('Serve approval-required failure stops the managed host and leaves no route', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-approval-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let hostStopped = false
  let revokeCalls = 0
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_005,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Approval</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_213, port: 41_005, url: 'http://127.0.0.1:41005/' }
      },
      async check() {
        return true
      },
      async stop() {
        hostStopped = true
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
        throw new privateModule.PrivatePreviewError(
          'TAILSCALE_SERVE_APPROVAL_REQUIRED',
          'Serve approval is required.'
        )
      },
      async revoke() {
        revokeCalls += 1
      },
    },
  })

  await assert.rejects(
    service.publish({
      name: 'Approval preview',
      idempotencyKey: 'private-preview-approval',
      artifactPath: '/tmp/approval-artifact',
    }),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'TAILSCALE_SERVE_APPROVAL_REQUIRED')
      assert.equal(error.receipt?.routeRevoked, true)
      assert.equal(error.receipt?.hostStopped, true)
      return true
    }
  )
  assert.equal(revokeCalls, 1)
  assert.equal(hostStopped, true)
})

test('loopback port conflict returns a stable code and removes the materialized snapshot', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-port-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_006,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Conflict</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        throw new privateModule.PrivatePreviewError(
          'PREVIEW_PORT_CONFLICT',
          'Port conflict.',
          true
        )
      },
      async check() {
        return false
      },
      async stop() {
        throw new Error('no host was started')
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
        throw new Error('must not serve')
      },
      async revoke() {},
    },
  })

  await assert.rejects(
    service.publish({
      name: 'Port conflict',
      idempotencyKey: 'private-preview-port-conflict',
      artifactPath: '/tmp/port-conflict-artifact',
    }),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PREVIEW_PORT_CONFLICT')
      assert.equal(error.receipt?.hostStopped, true)
      return true
    }
  )
  assert.deepEqual(await readdir(join(stateRoot, 'previews')), [])
})

test('managed preview host kills a real child that reports readiness too late', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-late-host-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const childModule = join(root, 'late-host.mjs')
  const pidPath = join(root, 'child.pid')
  await writeFile(
    childModule,
    [
      "import { writeFileSync } from 'node:fs'",
      'writeFileSync(process.argv[2], String(process.pid))',
      "setTimeout(() => process.send?.({ type: 'ready', pid: process.pid, port: 41014 }), 1500)",
      'setInterval(() => undefined, 1000)',
    ].join('\n')
  )
  const privateModule = await import('./private-preview.js')
  const startManagedHost = (privateModule as unknown as Record<string, unknown>)[
    'startManagedPreviewHostProcess'
  ]
  assert.equal(typeof startManagedHost, 'function')

  await assert.rejects(
    (startManagedHost as (
      input: Record<string, unknown>,
      options: Record<string, unknown>
    ) => Promise<unknown>)(
      {
        artifactRoot: pidPath,
        previewId: 'private_1234567890abcdef1234',
        artifactSha256: 'b'.repeat(64),
        port: 41014,
      },
      {
        modulePath: childModule,
        execArguments: [],
        readinessTimeoutMs: 100,
        stopTimeoutMs: 1_000,
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PREVIEW_HOST_START_FAILED')
      return true
    }
  )
  const childPid = Number(await (await import('node:fs/promises')).readFile(pidPath, 'utf8'))
  assert.throws(
    () => process.kill(childPid, 0),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ESRCH'
  )
})

test('managed preview host rejects mismatched IPC identity and kills the real child', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-mismatch-host-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const childModule = join(root, 'mismatch-host.mjs')
  const pidPath = join(root, 'child.pid')
  await writeFile(
    childModule,
    [
      "import { writeFileSync } from 'node:fs'",
      'writeFileSync(process.argv[2], String(process.pid))',
      "process.send?.({ type: 'ready', pid: process.pid + 1, port: 41019 })",
      'setInterval(() => undefined, 1000)',
    ].join('\n')
  )
  const privateModule = await import('./private-preview.js')
  await assert.rejects(
    privateModule.startManagedPreviewHostProcess(
      {
        artifactRoot: pidPath,
        previewId: 'private_1234567890abcdef1234',
        artifactSha256: 'b'.repeat(64),
        port: 41018,
      },
      {
        modulePath: childModule,
        execArguments: [],
        readinessTimeoutMs: 1_000,
        stopTimeoutMs: 1_000,
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PREVIEW_HOST_START_FAILED')
      return true
    }
  )
  const childPid = Number(await readFile(pidPath, 'utf8'))
  assert.throws(
    () => process.kill(childPid, 0),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ESRCH'
  )
})

test('managed preview host remains supervised until its ownership journal commits', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-host-journal-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'index.html'), '<h1>Journal</h1>')
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('missing loopback port'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
  const privateModule = await import('./private-preview.js')
  let childPid = 0

  await assert.rejects(
    privateModule.startManagedPreviewHostProcess(
      {
        artifactRoot: root,
        previewId: 'private_1234567890abcdef1234',
        artifactSha256: 'b'.repeat(64),
        port,
      },
      {
        beforeDetach: async (identity) => {
          childPid = identity.pid
          throw new Error('ownership journal failed')
        },
      }
    ),
    /ownership journal failed/
  )
  assert.ok(childPid > 0)
  assert.throws(
    () => process.kill(childPid, 0),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ESRCH'
  )
})

test('managed preview host exits when its parent dies before journal activation', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-parent-crash-'))
  let childPid = 0
  context.after(async () => {
    if (childPid > 0) {
      try {
        process.kill(childPid, 'SIGTERM')
      } catch {
        // The expected path already stopped the exact child.
      }
    }
    await rm(root, { recursive: true, force: true })
  })
  const artifactRoot = join(root, 'artifact')
  const parentModule = join(root, 'parent.mjs')
  const childPidPath = join(root, 'preview-child.pid')
  await mkdir(artifactRoot)
  await writeFile(join(artifactRoot, 'index.html'), '<h1>Crash</h1>')
  await writeFile(
    parentModule,
    [
      "import { writeFileSync } from 'node:fs'",
      'const [moduleUrl, artifactRoot, childPidPath, rawPort] = process.argv.slice(2)',
      'const privateModule = await import(moduleUrl)',
      'await privateModule.startManagedPreviewHostProcess({',
      "  previewId: 'private_1234567890abcdef1234',",
      "  artifactSha256: 'b'.repeat(64),",
      '  artifactRoot,',
      '  port: Number(rawPort),',
      '}, {',
      '  beforeDetach: async (identity) => {',
      "    writeFileSync(childPidPath, String(identity.pid), { mode: 0o600 })",
      "    process.kill(process.pid, 'SIGKILL')",
      '    await new Promise(() => undefined)',
      '  },',
      '})',
    ].join('\n')
  )
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('missing loopback port'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
  const privateModuleUrl = pathToFileURL(
    join(process.cwd(), 'src', 'private-preview.ts')
  ).href
  const parent = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      parentModule,
      privateModuleUrl,
      artifactRoot,
      childPidPath,
      String(port),
    ],
    { cwd: process.cwd(), stdio: 'ignore' }
  )
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('parent crash test timed out')),
      5_000
    )
    parent.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    parent.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
  childPid = Number(await readFile(childPidPath, 'utf8'))
  assert.ok(childPid > 0)

  let childAlive = true
  const deadline = Date.now() + 3_000
  while (childAlive && Date.now() < deadline) {
    try {
      process.kill(childPid, 0)
      await new Promise((resolve) => setTimeout(resolve, 25))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        childAlive = false
      } else {
        throw error
      }
    }
  }
  assert.equal(childAlive, false)
})

test('managed host stop requires PID exit after a transient health failure', async () => {
  const privateModule = await import('./private-preview.js')
  const createHostController = (privateModule as unknown as Record<string, unknown>)[
    'createManagedHostController'
  ]
  assert.equal(typeof createHostController, 'function')
  let checks = 0
  let signals = 0
  const controller = (createHostController as (
    options: Record<string, unknown>
  ) => {
    stop(input: Record<string, unknown>): Promise<{ stopped: boolean; stale: boolean }>
  })({
    check: async () => ++checks === 1,
    processExists: async () => true,
    signal: () => {
      signals += 1
    },
    stopTimeoutMs: 5,
    pollIntervalMs: 0,
  })

  const stopped = await controller.stop({
    previewId: 'private_1234567890abcdef1234',
    artifactSha256: 'b'.repeat(64),
    pid: 43_224,
    port: 41015,
    url: 'http://127.0.0.1:41015/',
  })
  assert.deepEqual(stopped, { stopped: false, stale: true })
  assert.equal(signals, 1)
  assert.ok(checks >= 2)
})

test('get marks a private preview degraded when its exact managed host is stale', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-stale-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let hostHealthy = true
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_007,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Stale</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_214, port: 41_007, url: 'http://127.0.0.1:41007/' }
      },
      async check() {
        return hostHealthy
      },
      async stop() {
        return { stopped: true, stale: !hostHealthy }
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
        return { url: 'https://rudi.example.ts.net:8443/' }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => true,
  })
  const published = await service.publish({
    name: 'Stale preview',
    idempotencyKey: 'private-preview-stale',
    artifactPath: '/tmp/stale-artifact',
  })
  hostHealthy = false
  const status = await service.get(published.preview.id)
  assert.equal(status.preview.status, 'degraded')
  assert.deepEqual(status.preview.health, {
    status: 'degraded',
    loopback: false,
    tailnet: false,
    checkedAt: status.preview.updatedAt,
    failureCode: 'STALE_PREVIEW_PROCESS',
  })
})

test('idempotent publish refreshes active preview health before replaying success', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-replay-health-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let hostHealthy = true
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_021,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Replay</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_230, port: 41_021, url: 'http://127.0.0.1:41021/' }
      },
      async check() {
        return hostHealthy
      },
      async stop() {
        return { stopped: true, stale: !hostHealthy }
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
        return { url: 'https://rudi.example.ts.net:8443/' }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => true,
  })
  const input = {
    name: 'Replay health',
    idempotencyKey: 'private-preview-replay-health',
    artifactPath: '/tmp/replay-health-artifact',
  }
  const published = await service.publish(input)
  assert.equal(published.preview.status, 'healthy')

  hostHealthy = false
  const replayed = await service.publish(input)
  assert.equal(replayed.outcome, 'published')
  assert.equal(replayed.preview.status, 'degraded')
  assert.equal(
    replayed.preview.health.failureCode,
    'STALE_PREVIEW_PROCESS'
  )
})

test('revocation receipts are compacted to a bounded durable retention window', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-receipt-retention-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let nextPid = 50_000
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 42_000,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Receipt</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start(input) {
        return {
          pid: nextPid++,
          port: input.port,
          url: `http://127.0.0.1:${input.port}/`,
        }
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
        return { url: 'https://rudi.example.ts.net:8443/' }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => true,
  })
  let latestPreviewId = ''
  for (let index = 0; index < 130; index += 1) {
    const published = await service.publish({
      name: `Receipt ${index}`,
      idempotencyKey: `private-preview-receipt-${index}`,
      artifactPath: `/tmp/receipt-artifact-${index}`,
    })
    latestPreviewId = published.preview.id
    await service.unpublish({
      previewId: published.preview.id,
      idempotencyKey: `private-preview-receipt-revoke-${index}`,
    })
  }

  const state = JSON.parse(
    await readFile(join(stateRoot, 'private-previews.json'), 'utf8')
  )
  assert.ok(Object.keys(state.previews).length <= 128)
  assert.equal((await service.get(latestPreviewId)).preview.status, 'revoked')
})

test('revocation compaction preserves cleanup-required host ownership', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-incomplete-retention-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let nextPid = 60_000
  let incompletePreviewId = ''
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 43_000,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Incomplete</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start(input) {
        return {
          pid: nextPid++,
          port: input.port,
          url: `http://127.0.0.1:${input.port}/`,
        }
      },
      async check() {
        return true
      },
      async stop(input) {
        return {
          stopped: input.previewId !== incompletePreviewId,
          stale: input.previewId === incompletePreviewId,
        }
      },
    },
    tailscale: {
      async status() {
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return []
      },
      async serve(input) {
        return { url: `https://rudi.example.ts.net:${input.httpsPort}/` }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => true,
  })

  const incomplete = await service.publish({
    name: 'Incomplete cleanup',
    idempotencyKey: 'private-preview-incomplete-cleanup',
    artifactPath: '/tmp/incomplete-cleanup-artifact',
  })
  incompletePreviewId = incomplete.preview.id
  await assert.rejects(
    service.unpublish({
      previewId: incompletePreviewId,
      idempotencyKey: 'private-preview-incomplete-revoke',
    }),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PARTIAL_REVOCATION_CLEANUP_FAILED')
      assert.equal(error.receipt?.hostStopped, false)
      return true
    }
  )

  for (let index = 0; index < 129; index += 1) {
    const published = await service.publish({
      name: `Complete receipt ${index}`,
      idempotencyKey: `private-preview-complete-receipt-${index}`,
      artifactPath: `/tmp/complete-receipt-artifact-${index}`,
    })
    await service.unpublish({
      previewId: published.preview.id,
      idempotencyKey: `private-preview-complete-revoke-${index}`,
    })
  }

  const state = JSON.parse(
    await readFile(join(stateRoot, 'private-previews.json'), 'utf8')
  )
  assert.equal(state.previews[incompletePreviewId].lifecycle, 'cleanup_required')
  assert.equal(state.previews[incompletePreviewId].lastHealth.loopback, true)
  assert.equal(state.previews[incompletePreviewId].revocationReceipt, null)
  assert.ok(Object.keys(state.previews).length <= 129)
})

test('multiple private previews avoid collisions even when live Serve status is delayed', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-multiple-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let nextLoopbackPort = 41_100
  let nextPid = 44_000
  const servedPorts: number[] = []
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => nextLoopbackPort++,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>Multiple</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start(input) {
        return {
          pid: nextPid++,
          port: input.port,
          url: `http://127.0.0.1:${input.port}/`,
        }
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
        return [{ httpsPort: 443, targetUrl: 'http://127.0.0.1:39999/' }]
      },
      async serve(input) {
        servedPorts.push(input.httpsPort)
        return { url: `https://rudi.example.ts.net:${input.httpsPort}/` }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => true,
  })

  const first = await service.publish({
    name: 'First private preview',
    idempotencyKey: 'private-preview-multiple-first',
    artifactPath: '/tmp/multiple-first',
  })
  const second = await service.publish({
    name: 'Second private preview',
    idempotencyKey: 'private-preview-multiple-second',
    artifactPath: '/tmp/multiple-second',
  })

  assert.equal(first.preview.httpsPort, 8443)
  assert.equal(second.preview.httpsPort, 8444)
  assert.notEqual(first.preview.id, second.preview.id)
  assert.deepEqual(servedPorts, [8443, 8444])
})

test('private preview safely recovers a state lock whose recorded process is gone', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-stale-lock-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  await writeFile(
    join(stateRoot, 'private-previews.lock'),
    JSON.stringify({ pid: 2_147_483_647, createdAt: '2026-08-29T00:00:00.000Z' })
  )
  const privateModule = await import('./private-preview.js')
  const service = privateModule.createPrivatePreviewService({ stateRoot })

  await assert.rejects(
    service.get('private_1234567890abcdef1234'),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PREVIEW_NOT_FOUND')
      return true
    }
  )
  assert.equal(
    (await readdir(stateRoot)).includes('private-previews.lock'),
    false
  )
})

test('private preview rejects tampered persisted state before network or process effects', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-invalid-state-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const previewId = 'private_1234567890abcdef1234'
  await writeFile(
    join(stateRoot, 'private-previews.json'),
    JSON.stringify({
      schemaVersion: 1,
      previews: {
        [previewId]: {
          id: previewId,
          name: 'Tampered preview',
          status: 'healthy',
          url: 'https://attacker.example:8443/',
          httpsPort: 8443,
          loopbackPort: 41003,
          hostPid: -1,
          targetUrl: 'http://169.254.169.254/latest/meta-data/',
          artifact: {
            sourcePath: '/tmp/tampered-artifact',
            sha256: 'b'.repeat(64),
            fileCount: 2,
            totalBytes: 42,
          },
          createdAt: '2026-08-29T14:00:00.000Z',
          updatedAt: '2026-08-29T14:00:00.000Z',
          revokedAt: null,
          lastHealth: {
            status: 'healthy',
            loopback: true,
            tailnet: true,
            checkedAt: '2026-08-29T14:00:00.000Z',
            failureCode: null,
          },
        },
      },
    })
  )
  const privateModule = await import('./private-preview.js')
  let hostChecks = 0
  let tailnetChecks = 0
  let providerCalls = 0
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    host: {
      async start() {
        throw new Error('must not start')
      },
      async check() {
        hostChecks += 1
        return true
      },
      async stop() {
        throw new Error('must not stop')
      },
    },
    tailscale: {
      async status() {
        providerCalls += 1
        throw new Error('must not query provider')
      },
      async listRoutes() {
        providerCalls += 1
        return []
      },
      async serve() {
        providerCalls += 1
        throw new Error('must not serve')
      },
      async revoke() {
        providerCalls += 1
      },
    },
    checkTailnetHealth: async () => {
      tailnetChecks += 1
      return true
    },
  })

  await assert.rejects(
    service.get(previewId),
    (error: unknown) => {
      assert.ok(error instanceof privateModule.PrivatePreviewError)
      assert.equal(error.code, 'PREVIEW_STATE_INVALID')
      return true
    }
  )
  assert.equal(hostChecks, 0)
  assert.equal(tailnetChecks, 0)
  assert.equal(providerCalls, 0)
})

test('get refreshes tailnet DNS provenance before any saved HTTPS health fetch', async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'rudi-share-dns-provenance-'))
  context.after(() => rm(stateRoot, { recursive: true, force: true }))
  const privateModule = await import('./private-preview.js')
  let statusCalls = 0
  let tailnetChecks = 0
  const service = privateModule.createPrivatePreviewService({
    stateRoot,
    allocateLoopbackPort: async () => 41_017,
    materializeArtifact: async (_source, destination) => {
      await mkdir(destination, { recursive: true })
      await writeFile(join(destination, 'index.html'), '<h1>DNS</h1>')
      return { root: destination, manifest }
    },
    host: {
      async start() {
        return { pid: 43_226, port: 41_017, url: 'http://127.0.0.1:41017/' }
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
        statusCalls += 1
        return { online: true, dnsName: 'rudi.example.ts.net' }
      },
      async listRoutes() {
        return []
      },
      async serve() {
        return { url: 'https://rudi.example.ts.net:8443/' }
      },
      async revoke() {},
    },
    checkTailnetHealth: async () => {
      tailnetChecks += 1
      return true
    },
  })
  const published = await service.publish({
    name: 'DNS provenance',
    idempotencyKey: 'private-preview-dns-provenance',
    artifactPath: '/tmp/dns-provenance-artifact',
  })
  tailnetChecks = 0
  const statePath = join(stateRoot, 'private-previews.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const record = state.previews[published.preview.id]
  record.tailnetDnsName = 'attacker.example'
  record.url = 'https://attacker.example:8443/'
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)

  const result = await service.get(published.preview.id)
  assert.equal(result.preview.status, 'degraded')
  assert.equal(
    result.preview.health.failureCode,
    'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH'
  )
  assert.equal(statusCalls, 2)
  assert.equal(tailnetChecks, 0)
})

test('managed health check refuses redirects without fetching their destination', async () => {
  const privateModule = await import('./private-preview.js')
  const checkHealth = (privateModule as unknown as Record<string, unknown>)[
    'checkManagedPreviewHealth'
  ]
  assert.equal(typeof checkHealth, 'function')
  const requests: string[] = []
  const healthy = await (checkHealth as (
    url: string,
    expected: Record<string, unknown>,
    fetchImpl: typeof fetch
  ) => Promise<boolean>)(
    'https://rudi.example.ts.net:8443/',
    {
      previewId: 'private_1234567890abcdef1234',
      artifactSha256: 'b'.repeat(64),
      pid: 43_227,
    },
    async (input, init) => {
      requests.push(String(input))
      assert.equal(init?.redirect, 'manual')
      return new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example/metadata' },
      })
    }
  )
  assert.equal(healthy, false)
  assert.deepEqual(requests, [
    'https://rudi.example.ts.net:8443/.__rudi_share/health',
  ])
})
