import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const stackRoot = fileURLToPath(new URL('../', import.meta.url))
const companionSkill = fileURLToPath(
  new URL('../../skills/share-web-app.md', new URL('../', import.meta.url))
)

async function collectTextFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (['dist', 'node_modules'].includes(entry.name)) continue
    const target = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectTextFiles(target))
    else if (
      entry.isFile() &&
      entry.name !== 'package-lock.json' &&
      entry.name !== 'package-contract.test.ts'
    ) files.push(target)
  }
  return files
}

test('package contract preserves the portable Share surface and companion workflow', async () => {
  const manifest = JSON.parse(await readFile(join(stackRoot, 'manifest.json'), 'utf8'))
  const skill = await readFile(companionSkill, 'utf8')

  assert.equal(manifest.id, 'stack:rudi-share')
  assert.deepEqual(manifest.related.skills, ['skill:share-web-app'])
  assert.deepEqual(manifest.provides.tools, [
    'rudi_share_preflight',
    'rudi_share_publish',
    'rudi_share_get',
    'rudi_share_unpublish',
  ])
  assert.deepEqual(
    manifest.requires.secrets.map((secret: { key: string }) => secret.key),
    ['RUDI_SHARE_API_URL', 'RUDI_SHARE_TOKEN']
  )
  assert.match(skill, /name: Share Web App/)
  assert.match(skill, /stack:rudi-share/)
  assert.match(skill, /rudi_share_publish/)
  assert.match(skill, /rudi_share_unpublish/)

  const packageFiles = await collectTextFiles(stackRoot)
  const packageContent = (await Promise.all(
    packageFiles.map((file) => readFile(file, 'utf8'))
  )).join('\n')
  assert.equal(packageContent.includes('/Users/'), false)
})
