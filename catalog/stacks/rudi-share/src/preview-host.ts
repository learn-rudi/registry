import { lstat, readFile, realpath } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PREVIEW_HEALTH_PATH = '/.__rudi_share/health'

export class PreviewHostError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ARTIFACT_PATH'
      | 'PREVIEW_PORT_CONFLICT'
      | 'PREVIEW_HOST_START_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'PreviewHostError'
  }
}

export interface CreatePreviewHostInput {
  artifactRoot: string
  previewId: string
  artifactSha256: string
  port: number
}

export interface PreviewHost {
  url: string
  port: number
  pid: number
  close: () => Promise<void>
}

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
])

function sendText(
  response: import('node:http').ServerResponse,
  status: number,
  text: string
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  response.end(text)
}

async function resolveArtifactFile(
  root: string,
  requestPath: string,
  acceptsHtml: boolean
): Promise<string | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    throw new PreviewHostError(
      'INVALID_ARTIFACT_PATH',
      'Preview request path is invalid.'
    )
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    throw new PreviewHostError(
      'INVALID_ARTIFACT_PATH',
      'Preview request path is invalid.'
    )
  }
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new PreviewHostError(
      'INVALID_ARTIFACT_PATH',
      'Preview request path is invalid.'
    )
  }

  const relativePath = segments.join('/') || 'index.html'
  let candidate = join(root, ...relativePath.split('/'))
  const contained = relative(root, candidate)
  if (contained === '..' || contained.startsWith('../')) {
    throw new PreviewHostError(
      'INVALID_ARTIFACT_PATH',
      'Preview request path is invalid.'
    )
  }

  try {
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) {
      throw new PreviewHostError(
        'INVALID_ARTIFACT_PATH',
        'Preview artifact cannot contain symbolic links.'
      )
    }
    if (info.isDirectory()) {
      candidate = join(candidate, 'index.html')
      const indexInfo = await lstat(candidate)
      if (!indexInfo.isFile() || indexInfo.isSymbolicLink()) return null
    } else if (!info.isFile()) {
      return null
    }
    return candidate
  } catch (error) {
    if (error instanceof PreviewHostError) throw error
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(String(error.code))
    ) {
      if (acceptsHtml && extname(relativePath) === '') return join(root, 'index.html')
      return null
    }
    throw error
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(
        error.code === 'EADDRINUSE'
          ? new PreviewHostError(
              'PREVIEW_PORT_CONFLICT',
              'The selected loopback preview port is already in use.'
            )
          : new PreviewHostError(
              'PREVIEW_HOST_START_FAILED',
              'The loopback preview host could not start.'
            )
      )
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(
          new PreviewHostError(
            'PREVIEW_HOST_START_FAILED',
            'The loopback preview host did not report a port.'
          )
        )
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

export async function createPreviewHost(
  input: CreatePreviewHostInput
): Promise<PreviewHost> {
  if (!isAbsolute(input.artifactRoot)) {
    throw new PreviewHostError(
      'INVALID_ARTIFACT_PATH',
      'Preview artifact root must be absolute.'
    )
  }
  if (!Number.isInteger(input.port) || input.port < 0 || input.port > 65_535) {
    throw new PreviewHostError(
      'PREVIEW_PORT_CONFLICT',
      'Preview port must be an integer between 0 and 65535.'
    )
  }
  const artifactRoot = await realpath(input.artifactRoot)
  if (!(await lstat(artifactRoot)).isDirectory()) {
    throw new PreviewHostError(
      'INVALID_ARTIFACT_PATH',
      'Preview artifact root must identify a directory.'
    )
  }

  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method ?? '')) {
        response.setHeader('allow', 'GET, HEAD')
        sendText(response, 405, 'Method not allowed.')
        return
      }
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (requestUrl.pathname === PREVIEW_HEALTH_PATH) {
        const body = JSON.stringify({
          status: 'healthy',
          previewId: input.previewId,
          artifactSha256: input.artifactSha256,
          pid: process.pid,
        })
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
        })
        response.end(request.method === 'HEAD' ? undefined : body)
        return
      }

      const file = await resolveArtifactFile(
        artifactRoot,
        requestUrl.pathname,
        (request.headers.accept ?? '').includes('text/html')
      )
      if (!file) {
        sendText(response, 404, 'Not found.')
        return
      }
      const content = await readFile(file)
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': content.length,
        'content-type': CONTENT_TYPES.get(extname(file).toLowerCase()) ??
          'application/octet-stream',
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch (error) {
      if (
        error instanceof PreviewHostError &&
        error.code === 'INVALID_ARTIFACT_PATH'
      ) {
        sendText(response, 400, 'Invalid path.')
        return
      }
      sendText(response, 500, 'Preview host failed safely.')
    }
  })
  const port = await listen(server, input.port)
  let closed = false

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    pid: process.pid,
    close: () =>
      new Promise((resolve, reject) => {
        if (closed) {
          resolve()
          return
        }
        closed = true
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function runPreviewHostProcess(): Promise<void> {
  const [artifactRoot, previewId, artifactSha256, rawPort] = process.argv.slice(2)
  const port = Number(rawPort)
  try {
    const host = await createPreviewHost({
      artifactRoot: artifactRoot ?? '',
      previewId: previewId ?? '',
      artifactSha256: artifactSha256 ?? '',
      port,
    })
    let activated = false
    let stopping = false
    const stop = async () => {
      if (stopping) return
      stopping = true
      await host.close()
      process.exit(0)
    }
    const stopBeforeActivation = () => {
      if (!activated) void stop()
    }
    process.once('disconnect', stopBeforeActivation)
    process.on('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'activate' &&
        'pid' in message &&
        message.pid === host.pid &&
        'port' in message &&
        message.port === host.port &&
        'previewId' in message &&
        message.previewId === previewId &&
        'artifactSha256' in message &&
        message.artifactSha256 === artifactSha256
      ) {
        activated = true
        process.off('disconnect', stopBeforeActivation)
        process.send?.({ type: 'activated', port: host.port, pid: host.pid })
      }
    })
    process.send?.({ type: 'ready', port: host.port, pid: host.pid })
    process.once('SIGTERM', () => void stop())
    process.once('SIGINT', () => void stop())
  } catch (error) {
    process.send?.({
      type: 'error',
      code: error instanceof PreviewHostError
        ? error.code
        : 'PREVIEW_HOST_START_FAILED',
    })
    process.exit(1)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  void runPreviewHostProcess()
}
