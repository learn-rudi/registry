import assert from 'node:assert/strict'
import test from 'node:test'

import { createRudiShareClient, RudiShareApiError } from './client.js'

test('API client keeps publisher credentials off signed uploads and exposes stable errors', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const responses = [
    Response.json(
      {
        schemaVersion: '2026-07-09',
        requestId: 'request-create',
        data: {
          share: {
            id: 'share_client',
            name: 'Client app',
            status: 'awaiting_upload',
            access: 'unlisted_link',
            publicUrl: 'https://share-client.example/',
            artifact: null,
            failureCode: null,
            createdAt: '2026-07-09T16:00:00.000Z',
            updatedAt: '2026-07-09T16:00:00.000Z',
          },
          upload: {
            id: 'upload_client',
            url: 'https://upload.example/v1/uploads/upload_client?signed=secret',
            expiresAt: '2026-07-09T16:10:00.000Z',
            contentType: 'application/vnd.rudi-share.tar',
            maxBytes: 26214400,
          },
        },
      },
      { status: 201 }
    ),
    Response.json(
      {
        schemaVersion: '2026-07-09',
        requestId: 'request-upload',
        data: {
          share: {
            id: 'share_client',
            name: 'Client app',
            status: 'published',
            access: 'unlisted_link',
            publicUrl: 'https://share-client.example/',
            artifact: { sha256: 'abc', fileCount: 1, totalBytes: 10 },
            failureCode: null,
            createdAt: '2026-07-09T16:00:00.000Z',
            updatedAt: '2026-07-09T16:01:00.000Z',
          },
        },
      },
      { status: 200 }
    ),
  ]
  const client = createRudiShareClient({
    apiUrl: 'https://control.example',
    publisherToken: 'publisher-token-with-at-least-thirty-two-bytes',
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init })
      const response = responses.shift()
      assert.ok(response)
      return response
    },
  })

  const created = await client.createShare('Client app', 'client-create-001')
  const published = await client.uploadArtifact(created.upload, Buffer.from('tar-bytes'))

  assert.equal(published.share.status, 'published')
  assert.equal(
    new Headers(calls[0]?.init.headers).get('authorization'),
    'Bearer publisher-token-with-at-least-thirty-two-bytes'
  )
  assert.equal(new Headers(calls[1]?.init.headers).has('authorization'), false)
  assert.equal(
    new Headers(calls[1]?.init.headers).get('content-type'),
    'application/vnd.rudi-share.tar'
  )

  const failingClient = createRudiShareClient({
    apiUrl: 'https://control.example',
    publisherToken: 'publisher-token-with-at-least-thirty-two-bytes',
    fetch: async () =>
      Response.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'do not echo publisher-token-with-at-least-thirty-two-bytes',
            retryable: true,
          },
        },
        { status: 429 }
      ),
  })
  await assert.rejects(
    failingClient.createShare('Client app', 'client-create-002'),
    (error: unknown) => {
      assert.ok(error instanceof RudiShareApiError)
      assert.equal(error.code, 'RATE_LIMITED')
      assert.equal(error.message.includes('publisher-token'), false)
      return true
    }
  )
})
