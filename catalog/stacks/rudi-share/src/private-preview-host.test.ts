import assert from 'node:assert/strict'
import childProcess, { spawn } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
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

test('managed preview host kills a real child that reports readiness too late', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-late-host-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const childModule = join(root, 'late-host.mjs')
  const realSpawn = childProcess.spawn
  let childPid: number | undefined
  const spawnObserver = context.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
    const child = realSpawn(...args)
    if (Array.isArray(args[1]) && args[1].includes(childModule)) childPid = child.pid
    return child
  })
  syncBuiltinESMExports()
  context.after(() => {
    spawnObserver.mock.restore()
    syncBuiltinESMExports()
  })
  await writeFile(
    childModule,
    [
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
        artifactRoot: root,
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
  // A real child can be killed before its JavaScript loads on a slower host.
  // Observe spawn's PID without requiring a child-written file before timeout.
  assert.equal(typeof childPid, 'number')
  assert.throws(
    () => process.kill(childPid as number, 0),
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
