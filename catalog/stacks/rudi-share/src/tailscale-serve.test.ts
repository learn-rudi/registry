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
