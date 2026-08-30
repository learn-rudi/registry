import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { packStaticArtifact } from './artifact.js'

const execFileAsync = promisify(execFile)

test('static artifact packing is bounded and byte-for-byte deterministic', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-artifact-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<h1>Artifact</h1>')
  await writeFile(join(root, 'assets', 'app.js'), 'ready()')

  const first = await packStaticArtifact(root)
  const second = await packStaticArtifact(root)

  assert.deepEqual(first.tar, second.tar)
  assert.deepEqual(first.manifest.files, [
    { path: 'assets/app.js', bytes: 7 },
    { path: 'index.html', bytes: 17 },
  ])
  assert.equal(first.manifest.fileCount, 2)
  assert.equal(first.manifest.totalBytes, 24)
  assert.match(first.manifest.sha256, /^[a-f0-9]{64}$/)
  assert.equal(first.tar.length % 512, 0)
})

test('static artifact materialization copies only the validated artifact snapshot', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-materialize-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const destination = join(root, 'runtime', 'artifact')
  await mkdir(join(source, 'assets'), { recursive: true })
  await writeFile(join(source, 'index.html'), '<script src="/assets/app.js"></script>')
  await writeFile(join(source, 'assets', 'app.js'), 'window.ready = true')

  const artifactModule = await import('./artifact.js')
  const materialize = (artifactModule as unknown as Record<string, unknown>)[
    'materializeStaticArtifact'
  ]
  assert.equal(typeof materialize, 'function')
  const result = await (materialize as (
    sourcePath: string,
    destinationPath: string
  ) => Promise<{ manifest: { sha256: string; fileCount: number } }>)(
    source,
    destination
  )

  await writeFile(join(source, 'assets', 'app.js'), 'source changed')
  assert.equal(
    await readFile(join(destination, 'assets', 'app.js'), 'utf8'),
    'window.ready = true'
  )
  assert.equal(result.manifest.fileCount, 2)
  assert.equal(result.manifest.sha256, (await packStaticArtifact(destination)).manifest.sha256)
})

test('static artifact rejects an oversized file from metadata before reading it', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-oversized-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const indexPath = join(root, 'index.html')
  await writeFile(indexPath, '')
  await truncate(indexPath, 25 * 1024 * 1024)
  await chmod(indexPath, 0o000)

  await assert.rejects(
    packStaticArtifact(root),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'code' in error)
      assert.equal(error.code, 'ARTIFACT_LIMIT_EXCEEDED')
      return true
    }
  )
})

test('static artifact rejects a file replaced with a symlink after metadata validation', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-artifact-swap-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const assetPath = join(source, 'assets', 'image.bin')
  const outsidePath = join(root, 'outside.bin')
  await mkdir(join(source, 'assets'), { recursive: true })
  await writeFile(join(source, 'index.html'), '<h1>Swap</h1>')
  await writeFile(assetPath, 'public')
  await writeFile(outsidePath, 'secret')

  let swapped = false
  await assert.rejects(
    packStaticArtifact(source, {
      beforeFileOpen: async (path) => {
        if (!path.endsWith('/assets/image.bin') || swapped) return
        swapped = true
        await rm(path)
        await symlink(outsidePath, path)
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'code' in error)
      assert.equal(error.code, 'UNSUPPORTED_ARTIFACT_ENTRY')
      return true
    }
  )
  assert.equal(swapped, true)
})

test('static artifact packing remains available when O_NOFOLLOW is unavailable', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-artifact-portable-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'index.html'), '<h1>Portable</h1>')

  const source = `
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    const { readFileSync } = require('node:fs')
    const { transformSync } = require('esbuild')
    const artifactSource = readFileSync(process.cwd() + '/src/artifact.ts', 'utf8')
    const withoutNoFollow = artifactSource.replace(
      "import { constants as fsConstants, type BigIntStats } from 'node:fs'",
      "import type { BigIntStats } from 'node:fs'\\n" +
        'const fsConstants = { O_RDONLY: 0, O_DIRECTORY: 0 }'
    )
    if (withoutNoFollow === artifactSource) process.exit(3)
    const transformed = transformSync(
      withoutNoFollow,
      { format: 'esm', loader: 'ts', target: 'node20' }
    ).code
    const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(transformed).toString('base64')
    const { packStaticArtifact } = await import(moduleUrl)
    const result = await packStaticArtifact(process.argv[1])
    if (result.manifest.fileCount !== 1) process.exitCode = 2
  `
  await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', source, root],
    { cwd: new URL('..', import.meta.url), timeout: 10_000 }
  )
})
