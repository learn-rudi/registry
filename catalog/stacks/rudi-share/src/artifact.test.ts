import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { packStaticArtifact } from './artifact.js'

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
