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
