export class RudiShareApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean
  ) {
    super(`RUDI Share API request failed (${code}).`)
    this.name = 'RudiShareApiError'
  }
}

export interface ShareSummary {
  id: string
  name: string
  status: string
  access: 'unlisted_link'
  publicUrl: string
  artifact: { sha256: string; fileCount: number; totalBytes: number } | null
  failureCode: string | null
  createdAt: string
  updatedAt: string
}

export interface UploadSession {
  id: string
  url: string
  expiresAt: string
  contentType: 'application/vnd.rudi-share.tar'
  maxBytes: number
}

export interface CreateShareResponse {
  share: ShareSummary
  upload: UploadSession
}

export interface ShareResponse {
  share: ShareSummary
}

export interface RudiShareClientOptions {
  apiUrl: string
  publisherToken: string
  fetch?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseShare(value: unknown): ShareSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.status !== 'string' ||
    value.access !== 'unlisted_link' ||
    typeof value.publicUrl !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
  }

  const artifact = value.artifact
  if (
    artifact !== null &&
    (!isRecord(artifact) ||
      typeof artifact.sha256 !== 'string' ||
      typeof artifact.fileCount !== 'number' ||
      typeof artifact.totalBytes !== 'number')
  ) {
    throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
  }
  if (value.failureCode !== null && typeof value.failureCode !== 'string') {
    throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
  }

  return value as unknown as ShareSummary
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
    throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
  }
  let envelope: unknown
  try {
    envelope = JSON.parse(text) as unknown
  } catch {
    throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
  }
  if (!isRecord(envelope)) {
    throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
  }

  if (!response.ok) {
    const error = envelope.error
    const code = isRecord(error) && typeof error.code === 'string'
      ? error.code
      : `HTTP_${response.status}`
    const retryable = isRecord(error) && error.retryable === true
    throw new RudiShareApiError(code, response.status, retryable)
  }
  if (!isRecord(envelope.data)) {
    throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
  }
  return envelope.data
}

export function createRudiShareClient(options: RudiShareClientOptions) {
  const apiUrl = new URL(options.apiUrl)
  if (!['http:', 'https:'].includes(apiUrl.protocol)) {
    throw new Error('RUDI_SHARE_API_URL must use HTTP or HTTPS.')
  }
  if (Buffer.byteLength(options.publisherToken, 'utf8') < 32) {
    throw new Error('RUDI_SHARE_TOKEN is missing or invalid.')
  }
  const fetchImpl = options.fetch ?? fetch

  async function controlRequest(
    path: string,
    init: RequestInit = {}
  ): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${options.publisherToken}`)
    try {
      return await parseResponse(
        await fetchImpl(new URL(path, apiUrl), { ...init, headers })
      )
    } catch (error) {
      if (error instanceof RudiShareApiError) throw error
      throw new RudiShareApiError('NETWORK_ERROR', 0, true)
    }
  }

  return {
    async createShare(name: string, idempotencyKey: string): Promise<CreateShareResponse> {
      const data = await controlRequest('/v1/shares', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ name }),
      })
      if (!isRecord(data.upload)) {
        throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
      }
      const upload = data.upload
      if (
        typeof upload.id !== 'string' ||
        typeof upload.url !== 'string' ||
        typeof upload.expiresAt !== 'string' ||
        upload.contentType !== 'application/vnd.rudi-share.tar' ||
        typeof upload.maxBytes !== 'number'
      ) {
        throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
      }
      return { share: parseShare(data.share), upload: upload as unknown as UploadSession }
    },

    async uploadArtifact(upload: UploadSession, tar: Buffer): Promise<ShareResponse> {
      if (tar.length > upload.maxBytes) {
        throw new RudiShareApiError('BODY_TOO_LARGE', 413, false)
      }
      let uploadUrl: URL
      try {
        uploadUrl = new URL(upload.url)
      } catch {
        throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
      }
      if (!['http:', 'https:'].includes(uploadUrl.protocol) || uploadUrl.username) {
        throw new RudiShareApiError('INVALID_API_RESPONSE', 502, true)
      }
      let response: Response
      try {
        response = await fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: {
            'content-type': upload.contentType,
            'content-length': tar.length.toString(10),
          },
          body: new Uint8Array(tar),
        })
      } catch {
        throw new RudiShareApiError('NETWORK_ERROR', 0, true)
      }
      const data = await parseResponse(response)
      return { share: parseShare(data.share) }
    },

    async getShare(shareId: string): Promise<ShareResponse> {
      const data = await controlRequest(`/v1/shares/${encodeURIComponent(shareId)}`)
      return { share: parseShare(data.share) }
    },

    async unpublish(shareId: string, idempotencyKey: string): Promise<ShareResponse> {
      const data = await controlRequest(
        `/v1/shares/${encodeURIComponent(shareId)}/unpublish`,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey },
        }
      )
      return { share: parseShare(data.share) }
    },
  }
}
