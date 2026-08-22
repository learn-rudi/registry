import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  buildPublicationBundle,
  MAX_PUBLICATION_CONTENT_CHARACTERS,
  parsePageInput,
  parsePublicationPreparationInput,
} from './contracts.js'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const CLIENT_ID = '20000000-0000-4000-8000-000000000002'
const APPROVAL_ID = '30000000-0000-4000-8000-000000000003'
const ZERO_SHA = '0'.repeat(64)
const BASE_REVISION = '1'.repeat(40)

test('page inputs are closed, bounded, and use UUID cursors', () => {
  assert.deepEqual(parsePageInput({ limit: 100 }), { limit: 100 })
  assert.throws(() => parsePageInput({ limit: 101 }), /limit/i)
  assert.throws(() => parsePageInput({ limit: 25, surprise: true }), /unknown/i)
  assert.throws(() => parsePageInput({ cursor: 'opaque-but-not-a-uuid' }), /cursor/i)
})

test('publication preparation permits only governed files and computes canonical digests', () => {
  const rawInput = {
    client_id: CLIENT_ID,
    approval_ids: [APPROVAL_ID],
    source_cutoff: '2026-08-20T12:00:00.000Z',
    git_remote: 'https://github.com/example/client.git',
    base_revision: BASE_REVISION,
    idempotency_key: 'projection-001',
    items: [{
      target_path: 'workspace/context.md',
      expected_file_sha256: ZERO_SHA,
      content: '# Context\n',
    }],
  }
  const input = parsePublicationPreparationInput(rawInput)
  const bundle = buildPublicationBundle(TENANT_ID, input)
  const operation = {
    op: 'replace',
    expectedFileSha256: ZERO_SHA,
    content: '# Context\n',
  }
  const expectedPatch = createHash('sha256').update(JSON.stringify({
    targetPath: 'workspace/context.md',
    operation,
  }), 'utf8').digest('hex')
  const expectedBundle = createHash('sha256').update(JSON.stringify({
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    approvalIds: [APPROVAL_ID],
    sourceCutoff: '2026-08-20T12:00:00.000Z',
    gitRemote: 'https://github.com/example/client.git',
    baseRevision: BASE_REVISION,
    items: [{ targetPath: 'workspace/context.md', patchDigest: expectedPatch }],
  }), 'utf8').digest('hex')

  assert.equal(bundle.items[0]?.patchDigest, expectedPatch)
  assert.equal(bundle.bundleDigest, expectedBundle)
  assert.throws(() => parsePublicationPreparationInput({
    ...rawInput,
    items: [{
      target_path: '../organization.sqlite',
      expected_file_sha256: ZERO_SHA,
      content: 'no',
    }],
  }), /target_path/i)
  assert.throws(() => parsePublicationPreparationInput({
    ...rawInput,
    items: [...rawInput.items, ...rawInput.items],
  }), /duplicate/i)
  assert.throws(() => parsePublicationPreparationInput({
    ...rawInput,
    git_remote: 'https://embedded-token@github.com/example/client.git',
  }), /git_remote/i)
  assert.throws(() => parsePublicationPreparationInput({
    ...rawInput,
    git_remote: 'ssh://not-git@github.com/example/client.git',
  }), /git_remote/i)
})

test('publication cutoff accepts only real RFC3339 calendar timestamps', () => {
  const input = {
    client_id: CLIENT_ID,
    approval_ids: [APPROVAL_ID],
    source_cutoff: '2024-02-29T23:59:59.123456789-05:00',
    git_remote: 'https://github.com/example/client.git',
    base_revision: BASE_REVISION,
    idempotency_key: 'projection-date',
    items: [{
      target_path: 'workspace/context.md',
      expected_file_sha256: ZERO_SHA,
      content: '# Context\n',
    }],
  }

  assert.equal(parsePublicationPreparationInput(input).sourceCutoff, input.source_cutoff)
  for (const invalid of [
    '2023-02-29T12:00:00Z',
    '2026-02-30T12:00:00Z',
    '2026-13-01T12:00:00Z',
    '2026-08-20T24:00:00Z',
    '2026-08-20T12:60:00Z',
    '2026-08-20T12:00:60Z',
    '2026-08-20T12:00:00+24:00',
  ]) {
    assert.throws(() => parsePublicationPreparationInput({ ...input, source_cutoff: invalid }), /source_cutoff/i)
  }
})

test('publication content uses a conservative character and UTF-8 byte contract', () => {
  const base = {
    client_id: CLIENT_ID,
    approval_ids: [APPROVAL_ID],
    source_cutoff: '2026-08-20T12:00:00Z',
    git_remote: 'https://github.com/example/client.git',
    base_revision: BASE_REVISION,
    idempotency_key: 'projection-content',
  }
  const content = '\u{1F642}'.repeat(MAX_PUBLICATION_CONTENT_CHARACTERS)
  assert.equal(Array.from(content).length, MAX_PUBLICATION_CONTENT_CHARACTERS)
  assert.doesNotThrow(() => parsePublicationPreparationInput({
    ...base,
    items: [{ target_path: 'workspace/context.md', expected_file_sha256: ZERO_SHA, content }],
  }))
  assert.throws(() => parsePublicationPreparationInput({
    ...base,
    items: [{ target_path: 'workspace/context.md', expected_file_sha256: ZERO_SHA, content: `${content}\u{1F642}` }],
  }), /content/i)
})
