import assert from 'node:assert/strict'
import test from 'node:test'

import { createShareWorkflow } from './workflow.js'

const pendingShare = {
  id: 'share_workflow',
  name: 'Workflow app',
  status: 'awaiting_upload',
  access: 'unlisted_link' as const,
  publicUrl: 'https://share-workflow.example/',
  artifact: null,
  failureCode: null,
  createdAt: '2026-07-09T16:00:00.000Z',
  updatedAt: '2026-07-09T16:00:00.000Z',
}

const upload = {
  id: 'upload_workflow',
  url: 'https://upload.example/v1/uploads/upload_workflow?signature=secret',
  expiresAt: '2026-07-09T16:10:00.000Z',
  contentType: 'application/vnd.rudi-share.tar' as const,
  maxBytes: 25 * 1024 * 1024,
}

test('publish and unpublish require explicit confirmation before remote mutation', async () => {
  let creates = 0
  let uploads = 0
  let unpublishes = 0
  const workflow = createShareWorkflow({
    client: {
      async createShare() {
        creates += 1
        return { share: pendingShare, upload }
      },
      async uploadArtifact() {
        uploads += 1
        return {
          share: {
            ...pendingShare,
            status: 'published',
            artifact: { sha256: 'abc', fileCount: 1, totalBytes: 10 },
          },
        }
      },
      async getShare() {
        return { share: pendingShare }
      },
      async unpublish() {
        unpublishes += 1
        return { share: { ...pendingShare, status: 'unpublished' } }
      },
    },
    packArtifact: async () => ({
      tar: Buffer.from('tar'),
      manifest: {
        sha256: 'abc',
        fileCount: 1,
        totalBytes: 10,
        files: [{ path: 'index.html', bytes: 10 }],
      },
    }),
  })

  const refusedPublish = await workflow.publish({
    name: 'Workflow app',
    idempotencyKey: 'publish-workflow-1',
    confirmPublication: false,
    artifactPath: '/tmp/app',
  })
  assert.equal(refusedPublish.outcome, 'confirmation_required')
  assert.equal(creates, 0)
  assert.equal(uploads, 0)

  const portable = await workflow.publish({
    name: 'Workflow app',
    idempotencyKey: 'publish-workflow-1',
    confirmPublication: true,
  })
  assert.equal(portable.outcome, 'upload_required')
  assert.equal(creates, 1)
  assert.equal(uploads, 0)

  const published = await workflow.publish({
    name: 'Workflow app',
    idempotencyKey: 'publish-workflow-2',
    confirmPublication: true,
    artifactPath: '/tmp/app',
  })
  assert.equal(published.outcome, 'published')
  assert.equal(creates, 2)
  assert.equal(uploads, 1)

  const refusedUnpublish = await workflow.unpublish({
    shareId: 'share_workflow',
    idempotencyKey: 'unpublish-workflow-1',
    confirmUnpublish: false,
  })
  assert.equal(refusedUnpublish.outcome, 'confirmation_required')
  assert.equal(unpublishes, 0)

  const unpublished = await workflow.unpublish({
    shareId: 'share_workflow',
    idempotencyKey: 'unpublish-workflow-1',
    confirmUnpublish: true,
  })
  assert.equal(unpublished.outcome, 'unpublished')
  assert.equal(unpublishes, 1)
})

test('tailnet-private publish requires its own explicit authorization before provider effects', async () => {
  let privatePublishes = 0
  const workflow = createShareWorkflow({
    client: {
      async createShare() {
        return { share: pendingShare, upload }
      },
      async uploadArtifact() {
        return { share: pendingShare }
      },
      async getShare() {
        return { share: pendingShare }
      },
      async unpublish() {
        return { share: pendingShare }
      },
    },
    privatePreview: {
      async publish() {
        privatePublishes += 1
        throw new Error('must not run')
      },
      async get() {
        throw new Error('not used')
      },
      async unpublish() {
        throw new Error('not used')
      },
    },
  } as Parameters<typeof createShareWorkflow>[0] & Record<string, unknown>)

  const result = await workflow.publish({
    name: 'Private mobile preview',
    idempotencyKey: 'private-preview-1',
    confirmPublication: false,
    confirmTailnetAccess: false,
    access: 'tailnet_private',
    provider: 'tailscale_serve',
    artifactPath: '/tmp/prepared-static-artifact',
  } as Parameters<typeof workflow.publish>[0] & Record<string, unknown>)

  assert.equal(result.outcome, 'confirmation_required')
  assert.equal(result.access, 'Tailnet private')
  assert.equal(result.provider, 'tailscale_serve')
  assert.equal(privatePublishes, 0)
})

test('tailnet-private publish get and unpublish dispatch without using the public client', async () => {
  const calls: string[] = []
  const preview = {
    id: 'private_1234567890abcdef1234',
    name: 'Private workflow',
    status: 'healthy' as const,
    url: 'https://rudi.example.ts.net:8443/',
    httpsPort: 8443,
    artifact: {
      sourcePath: '/tmp/private-workflow-artifact',
      sha256: 'c'.repeat(64),
      fileCount: 1,
      totalBytes: 10,
    },
    health: {
      status: 'healthy' as const,
      loopback: true,
      tailnet: true,
      checkedAt: '2026-08-29T16:00:00.000Z',
      failureCode: null,
    },
    createdAt: '2026-08-29T16:00:00.000Z',
    updatedAt: '2026-08-29T16:00:00.000Z',
    revokedAt: null,
  }
  const publicClient = new Proxy({}, {
    get() {
      return async () => {
        throw new Error('public client must not be called')
      }
    },
  })
  const workflow = createShareWorkflow({
    client: publicClient,
    privatePreview: {
      async publish() {
        calls.push('publish')
        return {
          outcome: 'published' as const,
          access: 'Tailnet private' as const,
          provider: 'tailscale_serve' as const,
          preview,
        }
      },
      async get() {
        calls.push('get')
        return {
          access: 'Tailnet private' as const,
          provider: 'tailscale_serve' as const,
          preview,
        }
      },
      async unpublish() {
        calls.push('unpublish')
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
            revokedAt: '2026-08-29T16:05:00.000Z',
          },
        }
      },
    },
  } as Parameters<typeof createShareWorkflow>[0])

  const published = await workflow.publish({
    name: 'Private workflow',
    idempotencyKey: 'private-workflow-publish',
    confirmPublication: false,
    confirmTailnetAccess: true,
    access: 'tailnet_private',
    provider: 'tailscale_serve',
    artifactPath: '/tmp/private-workflow-artifact',
  })
  assert.equal((published as { provider: string }).provider, 'tailscale_serve')

  const status = await (workflow.get as unknown as (
    input: Record<string, unknown>
  ) => Promise<Record<string, unknown>>)({
    shareId: preview.id,
    access: 'tailnet_private',
    provider: 'tailscale_serve',
  })
  assert.equal(status.provider, 'tailscale_serve')

  const unpublished = await workflow.unpublish({
    shareId: preview.id,
    idempotencyKey: 'private-workflow-unpublish',
    confirmUnpublish: true,
    access: 'tailnet_private',
    provider: 'tailscale_serve',
  } as Parameters<typeof workflow.unpublish>[0] & Record<string, unknown>)
  assert.equal((unpublished as { provider: string }).provider, 'tailscale_serve')
  assert.deepEqual(calls, ['publish', 'get', 'unpublish'])
})
