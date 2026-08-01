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
