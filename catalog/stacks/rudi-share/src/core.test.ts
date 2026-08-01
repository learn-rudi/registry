import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { preflightProject } from './core.js'

test('preflight distinguishes vanilla and React-Vite without modifying projects', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-preflight-'))
  context.after(() => rm(root, { recursive: true, force: true }))

  const vanilla = join(root, 'vanilla')
  await mkdir(vanilla)
  await writeFile(join(vanilla, 'index.html'), '<h1>Vanilla</h1>')

  const reactVite = join(root, 'react-vite')
  await mkdir(reactVite)
  await writeFile(
    join(reactVite, 'package.json'),
    JSON.stringify({
      scripts: { build: 'vite build' },
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^7.0.0' },
    })
  )
  await writeFile(join(reactVite, 'package-lock.json'), '{}')
  const canonicalVanilla = await realpath(vanilla)
  const canonicalReactVite = await realpath(reactVite)

  assert.deepEqual(await preflightProject(vanilla), {
    projectPath: canonicalVanilla,
    projectType: 'vanilla',
    artifactPath: canonicalVanilla,
    buildRequired: false,
    installCommand: null,
    buildCommand: null,
    blockers: [],
    warnings: [],
  })
  assert.deepEqual(await preflightProject(reactVite), {
    projectPath: canonicalReactVite,
    projectType: 'react-vite',
    artifactPath: join(canonicalReactVite, 'dist'),
    buildRequired: true,
    installCommand: 'npm ci',
    buildCommand: 'npm run build',
    blockers: [],
    warnings: [],
  })
})
