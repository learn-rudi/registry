import assert from 'node:assert/strict'
import test from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createServer, TOOL_DEFINITIONS } from './index.js'
import type { ManagedAiClient } from './client.js'

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

test('MCP exposes only the API-backed Managed AI surface and executes a bounded read', async (context) => {
  const calls: unknown[] = []
  const clientStub = {
    getClientContext: async (input: unknown) => ({ kind: 'client', input }),
    getOrganizationContext: async (input: unknown) => {
      calls.push(input)
      return {
        id: '30000000-0000-4000-8000-000000000003',
        name: 'Example organization',
        lifecycle: 'active',
        interactions: [],
      }
    },
    listInteractions: async () => ({ items: [] }),
    listObservations: async () => ({ items: [] }),
    listCandidates: async () => ({ items: [] }),
    reviewCandidate: async () => ({ id: 'approval' }),
    prepareProjection: async () => ({ id: 'projection' }),
    getProjectionBundle: async () => ({ id: 'projection' }),
  } satisfies ManagedAiClient
  const server = createServer({ client: clientStub, configStatus: {
    api_url_configured: true,
    bearer_token_configured: true,
    tenant_id_configured: true,
    transport: 'authenticated_https_api',
    raw_sql_enabled: false,
  } })
  const mcpClient = new Client({ name: 'managed-ai-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  context.after(async () => {
    await mcpClient.close()
    await server.close()
  })
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

  const listed = await mcpClient.listTools()
  assert.deepEqual(listed.tools.map((tool) => tool.name), EXPECTED_TOOLS)
  assert.ok(listed.tools.every((tool) => tool.inputSchema.additionalProperties === false))

  const result = await mcpClient.callTool({
    name: 'managed_ai_get_organization_context',
    arguments: {
      organization_id: '30000000-0000-4000-8000-000000000003',
      limit: 25,
    },
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(calls, [{
    organizationId: '30000000-0000-4000-8000-000000000003',
    limit: 25,
  }])
})

test('MCP rejects unknown fields before the HTTP client and returns a stable error', async (context) => {
  let called = false
  const clientStub = {
    getClientContext: async () => { called = true; return {} },
    getOrganizationContext: async () => ({}),
    listInteractions: async () => ({}),
    listObservations: async () => ({}),
    listCandidates: async () => ({}),
    reviewCandidate: async () => ({}),
    prepareProjection: async () => ({}),
    getProjectionBundle: async () => ({}),
  } satisfies ManagedAiClient
  const server = createServer({ client: clientStub })
  const mcpClient = new Client({ name: 'managed-ai-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  context.after(async () => {
    await mcpClient.close()
    await server.close()
  })
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

  const result = await mcpClient.callTool({
    name: 'managed_ai_get_client_context',
    arguments: {
      client_id: '20000000-0000-4000-8000-000000000002',
      limit: 10,
      raw_sql: 'select * from secrets',
    },
  })
  assert.equal(result.isError, true)
  const content = result.content[0]
  assert.ok(content && content.type === 'text')
  const body = JSON.parse(content.text) as { error: { code: string } }
  assert.equal(body.error.code, 'INVALID_INPUT')
  assert.equal(called, false)
})

test('MCP requires explicit confirmations before decision or projection API calls', async (context) => {
  let decisions = 0
  let projections = 0
  const clientStub = {
    getClientContext: async () => ({}),
    getOrganizationContext: async () => ({}),
    listInteractions: async () => ({}),
    listObservations: async () => ({}),
    listCandidates: async () => ({}),
    reviewCandidate: async () => { decisions += 1; return {} },
    prepareProjection: async () => { projections += 1; return {} },
    getProjectionBundle: async () => ({}),
  } satisfies ManagedAiClient
  const server = createServer({ client: clientStub })
  const mcpClient = new Client({ name: 'managed-ai-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  context.after(async () => {
    await mcpClient.close()
    await server.close()
  })
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

  const decision = await mcpClient.callTool({
    name: 'managed_ai_review_candidate',
    arguments: {
      candidate_id: '50000000-0000-4000-8000-000000000005',
      expected_version: 1,
      proposal_digest: 'a'.repeat(64),
      decision: 'approve',
      reason: 'Not yet confirmed.',
      idempotency_key: 'review-001',
      confirm_decision: false,
    },
  })
  const projection = await mcpClient.callTool({
    name: 'managed_ai_prepare_projection',
    arguments: {
      client_id: '20000000-0000-4000-8000-000000000002',
      approval_ids: ['40000000-0000-4000-8000-000000000004'],
      source_cutoff: '2026-08-20T12:00:00.000Z',
      git_remote: 'https://github.com/example/client.git',
      base_revision: '1'.repeat(40),
      idempotency_key: 'projection-001',
      confirm_prepare: false,
      items: [{
        target_path: 'workspace/context.md',
        expected_file_sha256: '0'.repeat(64),
        content: '# Context\n',
      }],
    },
  })

  assert.equal(decision.isError, true)
  assert.equal(projection.isError, true)
  assert.equal(decisions, 0)
  assert.equal(projections, 0)
})

test('MCP projection schema matches the conservative runtime content limit', () => {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === 'managed_ai_prepare_projection')
  assert.ok(definition && 'items' in definition.inputSchema.properties)
  const items = definition.inputSchema.properties.items
  assert.equal(items.items.properties.content.maxLength, 5_000)
  assert.match(items.items.properties.content.description, /UTF-8/i)
})

test('MCP rejects bearer and raw-provider echoes before serialization', async (context) => {
  const secret = 'test-bearer-token-that-must-not-serialize'
  const clientStub = {
    getClientContext: async () => ({
      id: '20000000-0000-4000-8000-000000000002',
      name: secret,
      lifecycle: 'shadow',
      organization_id: '30000000-0000-4000-8000-000000000003',
      organization_name: 'Example organization',
      interactions: [],
      tasks: [],
    }),
    getOrganizationContext: async () => ({}),
    listInteractions: async () => ({}),
    listObservations: async () => ({}),
    listCandidates: async () => ({
      items: [{
        id: '50000000-0000-4000-8000-000000000005',
        proposal_kind: 'client_match',
        state: 'pending',
        version: 1,
        client_id: null,
        source_observation_id: null,
        evidence: { raw_provider_payload: { body: 'private inbox data' } },
        patch_digest_sha256: 'a'.repeat(64),
        created_at: '2026-08-20T12:00:00Z',
      }],
      nextCursor: null,
    }),
    reviewCandidate: async () => ({}),
    prepareProjection: async () => ({}),
    getProjectionBundle: async () => ({}),
  } satisfies ManagedAiClient
  const server = createServer({ client: clientStub, sensitiveValues: [secret] })
  const mcpClient = new Client({ name: 'managed-ai-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  context.after(async () => {
    await mcpClient.close()
    await server.close()
  })
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

  const invokeSecret = () => mcpClient.callTool({
    name: 'managed_ai_get_client_context',
    arguments: { client_id: '20000000-0000-4000-8000-000000000002' },
  })
  const secretResult = await invokeSecret()
  assert.equal(secretResult.isError, true)
  const secretText = secretResult.content[0]
  assert.ok(secretText && secretText.type === 'text')
  assert.equal(secretText.text.includes(secret), false)

  const rawResult = await mcpClient.callTool({
    name: 'managed_ai_list_candidates',
    arguments: { limit: 10 },
  })
  assert.equal(rawResult.isError, true)
  const rawText = rawResult.content[0]
  assert.ok(rawText && rawText.type === 'text')
  assert.equal(rawText.text.includes('private inbox data'), false)
})
