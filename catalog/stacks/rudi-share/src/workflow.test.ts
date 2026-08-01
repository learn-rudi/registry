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
