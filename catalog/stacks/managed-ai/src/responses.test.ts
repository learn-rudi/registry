import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseCandidatePageResponse,
  parseClientContextResponse,
  parseDecisionResponse,
  parseInteractionPageResponse,
  parseObservationPageResponse,
  parseOrganizationContextResponse,
  parseProjectionBundleResponse,
  parseProjectionPreparationResponse,
  ResponseContractError,
} from './responses.js'

const ID = '10000000-0000-4000-8000-000000000001'
const OTHER_ID = '20000000-0000-4000-8000-000000000002'
const SHA = 'a'.repeat(64)
const REVISION = 'b'.repeat(40)
const NOW = '2026-08-20T12:00:00Z'
const TOKEN = 'test-bearer-token-that-is-never-returned'

test('response DTOs accept the exact foundation API shapes', () => {
  assert.equal(parseClientContextResponse(null, TOKEN), null)
  assert.equal(parseOrganizationContextResponse(null, TOKEN), null)
  assert.deepEqual(parseClientContextResponse({
    id: ID,
    name: 'Example client',
    lifecycle: 'shadow',
    organization_id: OTHER_ID,
    organization_name: 'Example organization',
    interactions: [{ id: OTHER_ID, kind: 'email', occurredAt: NOW, title: null }],
    tasks: [{ id: OTHER_ID, title: 'Follow up', state: 'open', dueAt: null }],
  }, TOKEN), {
    id: ID,
    name: 'Example client',
    lifecycle: 'shadow',
    organization_id: OTHER_ID,
    organization_name: 'Example organization',
    interactions: [{ id: OTHER_ID, kind: 'email', occurredAt: NOW, title: null }],
    tasks: [{ id: OTHER_ID, title: 'Follow up', state: 'open', dueAt: null }],
  })
  assert.deepEqual(parseOrganizationContextResponse({
    id: ID,
    name: 'Example organization',
    lifecycle: 'active',
    interactions: [],
  }, TOKEN), {
    id: ID,
    name: 'Example organization',
    lifecycle: 'active',
    interactions: [],
  })
  assert.doesNotThrow(() => parseInteractionPageResponse({
    items: [{
      id: ID,
      client_id: OTHER_ID,
      organization_id: null,
      engagement_id: null,
      interaction_kind: 'email',
      occurred_at: NOW,
      title: null,
      summary: 'Privacy-minimized summary.',
      observation_id: OTHER_ID,
      approval_id: OTHER_ID,
    }],
    nextCursor: ID,
  }, TOKEN))
  assert.doesNotThrow(() => parseObservationPageResponse({
    items: [{
      id: ID,
      source_item_id: OTHER_ID,
      observation_kind: 'email',
      schema_version: 1,
      occurred_at: NOW,
      title: null,
      payload_digest_sha256: SHA,
      created_at: NOW,
    }],
    nextCursor: null,
  }, TOKEN))
  assert.doesNotThrow(() => parseCandidatePageResponse({
    items: [{
      id: ID,
      proposal_kind: 'client_match',
      state: 'pending',
      version: 1,
      client_id: null,
      source_observation_id: OTHER_ID,
      target: { domain: 'example.com' },
      patch_operations: [],
      evidence: { matchKind: 'exact_approved_identifier', sourceCount: 1 },
      patch_digest_sha256: SHA,
      created_at: NOW,
    }],
    nextCursor: null,
  }, TOKEN))
  assert.deepEqual(parseDecisionResponse({ id: ID, replayed: false }, TOKEN), { id: ID, replayed: false })
  assert.deepEqual(
    parseProjectionPreparationResponse({ id: ID, state: 'prepared', replayed: true }, TOKEN),
    { id: ID, state: 'prepared', replayed: true },
  )
  assert.doesNotThrow(() => parseProjectionBundleResponse({
    id: ID,
    client_id: OTHER_ID,
    source_cutoff: NOW,
    git_remote: 'https://github.com/example/client.git',
    base_revision: REVISION,
    state: 'prepared',
    bundle_digest_sha256: SHA,
    accepted_revision: null,
    created_at: NOW,
    items: [{
      target_path: 'workspace/context.md',
      patch_digest_sha256: SHA,
      patch_operations: [{ op: 'replace', expectedFileSha256: SHA, content: '# Context\n' }],
    }],
    approvals: [{
      approval_id: ID,
      proposal_id: OTHER_ID,
      proposal_version: 1,
      patch_digest_sha256: SHA,
      decided_at: NOW,
    }],
  }, TOKEN))
})

test('response DTOs reject missing, unknown, mismatched, and null mutation shapes', () => {
  for (const value of [
    null,
    { id: ID },
    { id: ID, replayed: false, surprise: true },
    { id: ID, replayed: 'false' },
  ]) {
    assert.throws(() => parseDecisionResponse(value, TOKEN), ResponseContractError)
  }
  assert.throws(() => parseProjectionPreparationResponse(null, TOKEN), ResponseContractError)
  assert.throws(() => parseOrganizationContextResponse({
    id: ID, name: 'Example', lifecycle: 'active', interactions: [], extra: true,
  }, TOKEN), ResponseContractError)
})

test('response DTOs reject bearer echoes and raw provider evidence', () => {
  assert.throws(() => parseOrganizationContextResponse({
    id: ID,
    name: TOKEN,
    lifecycle: 'active',
    interactions: [],
  }, TOKEN), ResponseContractError)
  assert.throws(() => parseCandidatePageResponse({
    items: [{
      id: ID,
      proposal_kind: 'client_match',
      state: 'pending',
      version: 1,
      client_id: null,
      source_observation_id: OTHER_ID,
      target: { domain: 'example.com' },
      patch_operations: [],
      evidence: { raw_provider_payload: { body: 'private inbox data' } },
      patch_digest_sha256: SHA,
      created_at: NOW,
    }],
    nextCursor: null,
  }, TOKEN), ResponseContractError)
})
