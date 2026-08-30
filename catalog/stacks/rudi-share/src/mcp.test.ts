import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createServer } from './index.js'

test('MCP lists the complete Share surface and executes preflight', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-mcp-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'vanilla'))
  await writeFile(join(root, 'vanilla', 'index.html'), '<h1>MCP</h1>')

  const server = createServer({
    workflow: {
      async publish() {
        return {
          outcome: 'confirmation_required' as const,
          access: 'Anyone with the link' as const,
          warning: 'Confirmation required.',
        }
      },
      async get() {
        throw new Error('not used')
      },
      async unpublish() {
        return {
          outcome: 'confirmation_required' as const,
          warning: 'Confirmation required.',
        }
      },
    },
  })
  const client = new Client({ name: 'rudi-share-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  context.after(async () => {
    await client.close()
    await server.close()
  })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])

  const tools = await client.listTools()
  assert.deepEqual(
    tools.tools.map((tool) => tool.name),
    [
      'rudi_share_preflight',
      'rudi_share_publish',
      'rudi_share_get',
      'rudi_share_unpublish',
    ]
  )

  const result = await client.callTool({
    name: 'rudi_share_preflight',
    arguments: { project_path: join(root, 'vanilla') },
  })
  assert.equal(result.isError, undefined)
  const content = result.content[0]
  assert.ok(content && content.type === 'text')
  const body = JSON.parse(content.text) as { projectType: string; blockers: string[] }
  assert.equal(body.projectType, 'vanilla')
  assert.deepEqual(body.blockers, [])
})

test('MCP routes explicit tailnet-private provider inputs through the existing tools', async (context) => {
  const calls: Array<{ method: string; input: unknown }> = []
  const preview = {
    id: 'private_1234567890abcdef1234',
    name: 'MCP private preview',
    status: 'healthy' as const,
    url: 'https://rudi.example.ts.net:8443/',
    httpsPort: 8443,
    artifact: {
      sourcePath: '/tmp/mcp-private-artifact',
      sha256: 'd'.repeat(64),
      fileCount: 1,
      totalBytes: 10,
    },
    health: {
      status: 'healthy' as const,
      loopback: true,
      tailnet: true,
      checkedAt: '2026-08-29T17:00:00.000Z',
      failureCode: null,
    },
    createdAt: '2026-08-29T17:00:00.000Z',
    updatedAt: '2026-08-29T17:00:00.000Z',
    revokedAt: null,
  }
  const server = createServer({
    workflow: {
      async publish(input: unknown) {
        calls.push({ method: 'publish', input })
        return {
          outcome: 'published' as const,
          access: 'Tailnet private' as const,
          provider: 'tailscale_serve' as const,
          preview,
        }
      },
      async get(input: unknown) {
        calls.push({ method: 'get', input })
        return {
          access: 'Tailnet private' as const,
          provider: 'tailscale_serve' as const,
          preview,
        }
      },
      async unpublish(input: unknown) {
        calls.push({ method: 'unpublish', input })
        return {
          outcome: 'unpublished' as const,
          access: 'Tailnet private' as const,
          provider: 'tailscale_serve' as const,
          preview: { ...preview, status: 'revoked' as const },
          receipt: {
            routeRevoked: true,
            hostStopped: true,
            artifactRemoved: true,
            staleProcess: false,
            revokedAt: '2026-08-29T17:05:00.000Z',
          },
        }
      },
    } as NonNullable<Parameters<typeof createServer>[0]['workflow']>,
  })
  const client = new Client({ name: 'rudi-share-private-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  context.after(async () => {
    await client.close()
    await server.close()
  })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])

  const published = await client.callTool({
    name: 'rudi_share_publish',
    arguments: {
      name: 'MCP private preview',
      idempotency_key: 'mcp-private-publish',
      confirm_publication: false,
      confirm_tailnet_access: true,
      access: 'tailnet_private',
      provider: 'tailscale_serve',
      artifact_path: '/tmp/mcp-private-artifact',
    },
  })
  assert.equal(published.isError, undefined)
  await client.callTool({
    name: 'rudi_share_get',
    arguments: {
      share_id: preview.id,
      access: 'tailnet_private',
      provider: 'tailscale_serve',
    },
  })
  await client.callTool({
    name: 'rudi_share_unpublish',
    arguments: {
      share_id: preview.id,
      idempotency_key: 'mcp-private-unpublish',
      confirm_unpublish: true,
      access: 'tailnet_private',
      provider: 'tailscale_serve',
    },
  })

  assert.deepEqual(calls, [
    {
      method: 'publish',
      input: {
        name: 'MCP private preview',
        idempotencyKey: 'mcp-private-publish',
        confirmPublication: false,
        confirmTailnetAccess: true,
        access: 'tailnet_private',
        provider: 'tailscale_serve',
        artifactPath: '/tmp/mcp-private-artifact',
      },
    },
    {
      method: 'get',
      input: {
        shareId: preview.id,
        access: 'tailnet_private',
        provider: 'tailscale_serve',
      },
    },
    {
      method: 'unpublish',
      input: {
        shareId: preview.id,
        idempotencyKey: 'mcp-private-unpublish',
        confirmUnpublish: true,
        access: 'tailnet_private',
        provider: 'tailscale_serve',
      },
    },
  ])
})

test('MCP starts without cloud credentials and gates only the public provider call', async (context) => {
  const originalApiUrl = process.env.RUDI_SHARE_API_URL
  const originalToken = process.env.RUDI_SHARE_TOKEN
  delete process.env.RUDI_SHARE_API_URL
  delete process.env.RUDI_SHARE_TOKEN
  context.after(() => {
    if (originalApiUrl === undefined) delete process.env.RUDI_SHARE_API_URL
    else process.env.RUDI_SHARE_API_URL = originalApiUrl
    if (originalToken === undefined) delete process.env.RUDI_SHARE_TOKEN
    else process.env.RUDI_SHARE_TOKEN = originalToken
  })

  const server = createServer()
  const client = new Client({ name: 'rudi-share-lazy-config-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  context.after(async () => {
    await client.close()
    await server.close()
  })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  assert.equal((await client.listTools()).tools.length, 4)

  const confirmation = await client.callTool({
    name: 'rudi_share_publish',
    arguments: {
      name: 'Legacy confirmation',
      idempotency_key: 'legacy-confirmation',
      confirm_publication: false,
    },
  })
  assert.equal(confirmation.isError, undefined)

  const publicCall = await client.callTool({
    name: 'rudi_share_publish',
    arguments: {
      name: 'Unconfigured public provider',
      idempotency_key: 'unconfigured-public-provider',
      confirm_publication: true,
    },
  })
  assert.equal(publicCall.isError, true)
  const content = publicCall.content[0]
  assert.ok(content && content.type === 'text')
  assert.equal(
    (JSON.parse(content.text) as { error: { code: string } }).error.code,
    'PUBLIC_PROVIDER_NOT_CONFIGURED'
  )
})
