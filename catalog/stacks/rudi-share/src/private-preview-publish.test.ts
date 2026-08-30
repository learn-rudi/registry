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
