import assert from 'node:assert/strict'
import test from 'node:test'

import { createManagedAiClient, ManagedAiApiError } from './client.js'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const CLIENT_ID = '20000000-0000-4000-8000-000000000002'
const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000003'
const APPROVAL_ID = '40000000-0000-4000-8000-000000000004'
const CANDIDATE_ID = '50000000-0000-4000-8000-000000000005'
const TOKEN = 'test-bearer-token-that-is-never-returned'

test('client forces configured tenant and bearer auth onto fixed bounded API paths', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const client = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return Response.json({
        id: ORGANIZATION_ID,
        name: 'Example',
        lifecycle: 'active',
        interactions: [],
      })
    },
  })

  await client.getOrganizationContext({ organizationId: ORGANIZATION_ID, limit: 25 })

  assert.equal(
    calls[0]?.url,
    `https://managed.example/v1/tenants/${TENANT_ID}/organizations/${ORGANIZATION_ID}/context?limit=25`
  )
  assert.equal(new Headers(calls[0]?.init.headers).get('authorization'), `Bearer ${TOKEN}`)
  assert.match(new Headers(calls[0]?.init.headers).get('x-correlation-id') ?? '', /^[0-9a-f-]{36}$/)
  assert.equal(calls[0]?.url.includes(TOKEN), false)
})

test('projection preparation computes digests locally and sends no file or Git side effect command', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const client = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return Response.json({
        id: '50000000-0000-4000-8000-000000000005',
        state: 'prepared',
        replayed: false,
      }, { status: 201 })
    },
  })
  await client.prepareProjection({
    clientId: CLIENT_ID,
    approvalIds: [APPROVAL_ID],
    sourceCutoff: '2026-08-20T12:00:00.000Z',
    gitRemote: 'https://github.com/example/client.git',
    baseRevision: '1'.repeat(40),
    idempotencyKey: 'projection-001',
    items: [{
      target_path: 'workspace/context.md',
      expected_file_sha256: '0'.repeat(64),
      content: '# Context\n',
    }],
  })

  const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
  assert.equal(calls[0]?.url, `https://managed.example/v1/tenants/${TENANT_ID}/clients/${CLIENT_ID}/publication-runs`)
  assert.equal(new Headers(calls[0]?.init.headers).get('idempotency-key'), 'projection-001')
  assert.match(String(body.bundleDigest), /^[0-9a-f]{64}$/)
  assert.equal(Array.isArray(body.items), true)
  assert.deepEqual(Object.keys(body).sort(), [
    'approvalIds', 'baseRevision', 'bundleDigest', 'gitRemote', 'items', 'sourceCutoff',
  ])
})

test('client fails closed on insecure endpoints and sanitizes API failures', async () => {
  assert.throws(() => createManagedAiClient({
    apiUrl: 'http://admin-mac.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
  }), /HTTPS/i)
  assert.throws(() => createManagedAiClient({
    apiUrl: 'https://managed.example/path?token=bad',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
  }), /origin/i)

  const client = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    fetch: async () => Response.json({ error: `denied: ${TOKEN}` }, { status: 403 }),
  })
  await assert.rejects(
    client.getClientContext({ clientId: CLIENT_ID, limit: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof ManagedAiApiError)
      assert.equal(error.code, 'HTTP_403')
      assert.equal(error.retryable, false)
      assert.equal(error.message.includes(TOKEN), false)
      return true
    }
  )
})

test('client rejects malformed and oversized API responses', async () => {
  const oversized = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    maximumResponseBytes: 64,
    fetch: async () => new Response(JSON.stringify({ data: 'x'.repeat(100) })),
  })
  await assert.rejects(
    oversized.listInteractions({ limit: 10 }),
    (error: unknown) => error instanceof ManagedAiApiError && error.code === 'INVALID_API_RESPONSE'
  )

  const malformed = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    fetch: async () => new Response('not-json'),
  })
  await assert.rejects(
    malformed.listCandidates({ limit: 10 }),
    (error: unknown) => error instanceof ManagedAiApiError && error.code === 'INVALID_API_RESPONSE'
  )
})

test('candidate decisions preserve exact version, digest, and idempotency through the API boundary', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const client = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return Response.json({ id: APPROVAL_ID, replayed: false })
    },
  })
  await client.reviewCandidate({
    candidateId: CANDIDATE_ID,
    expectedVersion: 7,
    proposalDigest: 'a'.repeat(64),
    decision: 'approve',
    reason: 'Approved exact relationship evidence.',
    idempotencyKey: 'candidate-review-001',
  })

  assert.equal(
    calls[0]?.url,
    `https://managed.example/v1/tenants/${TENANT_ID}/proposals/${CANDIDATE_ID}/decisions`,
  )
  assert.equal(new Headers(calls[0]?.init.headers).get('idempotency-key'), 'candidate-review-001')
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    expectedVersion: 7,
    proposalDigest: 'a'.repeat(64),
    decision: 'approve',
    reason: 'Approved exact relationship evidence.',
  })
})

test('request timeout remains active while a response body is still streaming', async () => {
  const client = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    timeoutMs: 100,
    fetch: async (_url, init = {}) => new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => {
          controller.error(new DOMException('request aborted', 'AbortError'))
        })
      },
    }), { headers: { 'content-type': 'application/json' } }),
  })

  await assert.rejects(
    Promise.race([
      client.listInteractions({ limit: 10 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('body read did not time out')), 350)),
    ]),
    (error: unknown) => error instanceof ManagedAiApiError && error.code === 'TIMEOUT' && error.retryable,
  )
})

test('known authorization failures retain their non-retryable status when the body is oversized', async () => {
  const client = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    maximumResponseBytes: 64,
    fetch: async () => new Response('x'.repeat(1_000), { status: 403 }),
  })

  await assert.rejects(
    client.listInteractions({ limit: 10 }),
    (error: unknown) => error instanceof ManagedAiApiError &&
      error.code === 'HTTP_403' && error.status === 403 && !error.retryable,
  )
})

test('known authorization failures retain their non-retryable status when the body stalls', async () => {
  const client = createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    timeoutMs: 100,
    fetch: async (_url, init = {}) => new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => {
          controller.error(new DOMException('request aborted', 'AbortError'))
        })
      },
    }), { status: 401 }),
  })

  await assert.rejects(
    Promise.race([
      client.listInteractions({ limit: 10 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('auth status was not returned')), 350)),
    ]),
    (error: unknown) => error instanceof ManagedAiApiError &&
      error.code === 'HTTP_401' && error.status === 401 && !error.retryable,
  )
})

test('endpoint response contracts reject unknown fields, null mutations, and credential echoes', async () => {
  const response = (body: unknown) => createManagedAiClient({
    apiUrl: 'https://managed.example',
    tenantId: TENANT_ID,
    bearerToken: TOKEN,
    fetch: async () => Response.json(body),
  })

  await assert.rejects(
    response({
      id: ORGANIZATION_ID,
      name: 'Example',
      lifecycle: 'active',
      interactions: [],
      surprise: true,
    }).getOrganizationContext({ organizationId: ORGANIZATION_ID, limit: 10 }),
    (error: unknown) => error instanceof ManagedAiApiError && error.code === 'INVALID_API_RESPONSE',
  )
  await assert.rejects(
    response(null).reviewCandidate({
      candidateId: CANDIDATE_ID,
      expectedVersion: 1,
      proposalDigest: 'a'.repeat(64),
      decision: 'approve',
      reason: 'Approved exact evidence.',
      idempotencyKey: 'candidate-review-null',
    }),
    (error: unknown) => error instanceof ManagedAiApiError && error.code === 'INVALID_API_RESPONSE',
  )
  await assert.rejects(
    response({
      items: [{
        id: CANDIDATE_ID,
        proposal_kind: 'client_match',
        state: 'pending',
        version: 1,
        client_id: null,
        source_observation_id: null,
        evidence: { explanation: TOKEN },
        patch_digest_sha256: 'a'.repeat(64),
        created_at: '2026-08-20T12:00:00Z',
      }],
      nextCursor: null,
    }).listCandidates({ limit: 10 }),
    (error: unknown) => error instanceof ManagedAiApiError && error.code === 'INVALID_API_RESPONSE',
  )
})
