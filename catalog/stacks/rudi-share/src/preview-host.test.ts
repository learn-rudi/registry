import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function rawGet(url: URL, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outbound = request(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method: 'GET',
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        )
      }
    )
    outbound.on('error', reject)
    outbound.end()
  })
}

test('preview host serves one static snapshot on loopback with SPA fallback and traversal rejection', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'rudi-share-host-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const artifactRoot = join(root, 'artifact')
  await mkdir(join(artifactRoot, 'assets'), { recursive: true })
  await writeFile(
    join(artifactRoot, 'index.html'),
    '<script src="/assets/app.js"></script>'
  )
  await writeFile(join(artifactRoot, 'assets', 'app.js'), 'window.ready = true')
  await writeFile(join(root, 'outside.txt'), 'must not be served')

  const hostModule = await import('./preview-host.js')
  const createPreviewHost = (hostModule as unknown as Record<string, unknown>)[
    'createPreviewHost'
  ]
  assert.equal(typeof createPreviewHost, 'function')
  const host = await (createPreviewHost as (input: {
    artifactRoot: string
    previewId: string
    artifactSha256: string
    port: number
  }) => Promise<{ url: string; close: () => Promise<void> }> )({
    artifactRoot,
    previewId: 'private_host_test',
    artifactSha256: 'a'.repeat(64),
    port: 0,
  })
  context.after(() => host.close())

  const baseUrl = new URL(host.url)
  assert.equal(baseUrl.hostname, '127.0.0.1')
  const rootResponse = await fetch(baseUrl)
  assert.equal(rootResponse.status, 200)
  assert.match(await rootResponse.text(), /\/assets\/app\.js/)

  const assetResponse = await fetch(new URL('/assets/app.js', baseUrl))
  assert.equal(assetResponse.status, 200)
  assert.equal(await assetResponse.text(), 'window.ready = true')

  const routeResponse = await fetch(new URL('/mobile/preview', baseUrl), {
    headers: { accept: 'text/html' },
  })
  assert.equal(routeResponse.status, 200)
  assert.match(await routeResponse.text(), /\/assets\/app\.js/)

  const traversal = await rawGet(baseUrl, '/..%2Foutside.txt')
  assert.equal(traversal.status, 400)
  assert.equal(traversal.body.includes('must not be served'), false)
})
