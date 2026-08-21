import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const EXPECTED_TOOLS = [
  'managed_ai_config_status',
  'managed_ai_get_client_context',
  'managed_ai_get_organization_context',
  'managed_ai_list_interactions',
  'managed_ai_list_observations',
  'managed_ai_list_candidates',
  'managed_ai_review_candidate',
  'managed_ai_prepare_projection',
  'managed_ai_get_projection_bundle',
]

test('package manifest declares an authenticated API-only boundary', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8')) as {
    provides: { tools: string[] }
    requires: { secrets: Array<{ key: string }> }
    meta: { boundary: string }
  }
  assert.deepEqual(manifest.provides.tools, EXPECTED_TOOLS)
  assert.deepEqual(
    manifest.requires.secrets.map((entry) => entry.key),
    ['RUDI_MANAGED_AI_API_URL', 'RUDI_MANAGED_AI_API_TOKEN', 'RUDI_MANAGED_AI_TENANT_ID'],
  )
  assert.match(manifest.meta.boundary, /API client only/i)
  assert.match(manifest.meta.boundary, /cannot open PostgreSQL/i)
})

test('runtime source has no database, tunnel, provider-polling, filesystem, or Git process primitive', async () => {
  const files = ['client.ts', 'contracts.ts', 'index.ts', 'responses.ts']
  const source = (await Promise.all(
    files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')),
  )).join('\n')
  for (const forbidden of [
    /from ['"]pg['"]/, /postgres(?:ql)?:\/\//i, /\bselect\s+.+\bfrom\b/i,
    /node:(?:fs|net|tls|child_process)/, /\bgit\s+(?:commit|push|apply)\b/i,
    /gmail\.googleapis\.com/i, /calendar\.googleapis\.com/i, /otter\.ai/i,
  ]) {
    assert.doesNotMatch(source, forbidden)
  }
})
