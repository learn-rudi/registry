import { packStaticArtifact, type PackedStaticArtifact } from './artifact.js'
import {
  createRudiShareClient,
  type ShareSummary,
  type UploadSession,
} from './client.js'
import type {
  PrivatePreviewGetResult,
  PrivatePreviewPublishResult,
  PrivatePreviewUnpublishResult,
} from './private-preview.js'

type ShareClient = Pick<
  ReturnType<typeof createRudiShareClient>,
  'createShare' | 'uploadArtifact' | 'getShare' | 'unpublish'
>

export interface ShareWorkflowDependencies {
  client?: ShareClient
  getPublicClient?: () => ShareClient
  packArtifact?: (artifactPath: string) => Promise<PackedStaticArtifact>
  privatePreview?: {
    publish(input: {
      name: string
      idempotencyKey: string
      artifactPath: string
    }): Promise<PrivatePreviewPublishResult>
    get(previewId: string): Promise<PrivatePreviewGetResult>
    unpublish(input: {
      previewId: string
      idempotencyKey: string
    }): Promise<PrivatePreviewUnpublishResult>
  }
}

export type ShareAccess = 'anyone_with_link' | 'tailnet_private'
export type ShareProvider = 'rudi_share_service' | 'tailscale_serve'

export interface PublishInput {
  name: string
  idempotencyKey: string
  confirmPublication: boolean
  artifactPath?: string
  access?: ShareAccess
  provider?: ShareProvider
  confirmTailnetAccess?: boolean
}

export interface UnpublishInput {
  shareId: string
  idempotencyKey: string
  confirmUnpublish: boolean
  access?: ShareAccess
  provider?: ShareProvider
}

export interface GetInput {
  shareId: string
  access?: ShareAccess
  provider?: ShareProvider
}

export type PublishResult =
  | {
      outcome: 'confirmation_required'
      access: 'Anyone with the link'
      provider: 'rudi_share_service'
      warning: string
    }
  | {
      outcome: 'upload_required'
      access: 'Anyone with the link'
      provider: 'rudi_share_service'
      share: ShareSummary
      upload: UploadSession
    }
  | {
      outcome: 'published'
      access: 'Anyone with the link'
      provider: 'rudi_share_service'
      share: ShareSummary
      artifact: PackedStaticArtifact['manifest']
    }
  | {
      outcome: 'confirmation_required'
      access: 'Tailnet private'
      provider: 'tailscale_serve'
      warning: string
    }
  | PrivatePreviewPublishResult

export type UnpublishResult =
  | {
      outcome: 'confirmation_required'
      access: 'Anyone with the link' | 'Tailnet private'
      provider: ShareProvider
      warning: string
    }
  | {
      outcome: 'unpublished'
      access: 'Anyone with the link'
      provider: 'rudi_share_service'
      share: ShareSummary
    }
  | PrivatePreviewUnpublishResult

export type GetResult =
  | {
      access: 'Anyone with the link'
      provider: 'rudi_share_service'
      share: ShareSummary
    }
  | PrivatePreviewGetResult

export class ShareWorkflowError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_PROVIDER_MODE'
      | 'PUBLIC_PROVIDER_NOT_CONFIGURED'
      | 'PRIVATE_PROVIDER_NOT_CONFIGURED'
      | 'PRIVATE_ARTIFACT_REQUIRED',
    message: string
  ) {
    super(message)
    this.name = 'ShareWorkflowError'
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} is required.`)
}

function resolveMode(input: {
  access?: ShareAccess
  provider?: ShareProvider
}): { access: ShareAccess; provider: ShareProvider } {
  const access = input.access ??
    (input.provider === 'tailscale_serve' ? 'tailnet_private' : 'anyone_with_link')
  const provider = input.provider ??
    (access === 'tailnet_private' ? 'tailscale_serve' : 'rudi_share_service')
  if (
    (access === 'tailnet_private' && provider !== 'tailscale_serve') ||
    (access === 'anyone_with_link' && provider !== 'rudi_share_service')
  ) {
    throw new ShareWorkflowError(
      'INVALID_PROVIDER_MODE',
      'access and provider must identify the same Share mode.'
    )
  }
  return { access, provider }
}

export function createShareWorkflow(dependencies: ShareWorkflowDependencies) {
  const packArtifact = dependencies.packArtifact ?? packStaticArtifact
  const publicClient = (): ShareClient => {
    const client = dependencies.client ?? dependencies.getPublicClient?.()
    if (!client) {
      throw new ShareWorkflowError(
        'PUBLIC_PROVIDER_NOT_CONFIGURED',
        'Anyone-with-the-link publication is not configured.'
      )
    }
    return client
  }

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      assertNonEmpty(input.name, 'name')
      assertNonEmpty(input.idempotencyKey, 'idempotency_key')
      const mode = resolveMode(input)
      if (mode.access === 'tailnet_private') {
        if (!input.confirmTailnetAccess) {
          return {
            outcome: 'confirmation_required',
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            warning:
              'This exposes the selected static artifact only to devices allowed by the current tailnet policy. Set confirm_tailnet_access to true only after the user approves tailnet access.',
          }
        }
        if (!input.artifactPath) {
          throw new ShareWorkflowError(
            'PRIVATE_ARTIFACT_REQUIRED',
            'artifact_path is required for tailnet-private preview.'
          )
        }
        if (!dependencies.privatePreview) {
          throw new ShareWorkflowError(
            'PRIVATE_PROVIDER_NOT_CONFIGURED',
            'Tailnet-private preview provider is unavailable.'
          )
        }
        return dependencies.privatePreview.publish({
          name: input.name,
          idempotencyKey: input.idempotencyKey,
          artifactPath: input.artifactPath,
        })
      }
      if (!input.confirmPublication) {
        return {
          outcome: 'confirmation_required',
          access: 'Anyone with the link',
          provider: 'rudi_share_service',
          warning:
            'Publishing creates a forwardable public URL. Set confirm_publication to true only after the user approves Anyone with the link access.',
        }
      }

      // Validate and package before allocating a remote share when local access exists.
      const artifact = input.artifactPath
        ? await packArtifact(input.artifactPath)
        : null
      const client = publicClient()
      const created = await client.createShare(
        input.name,
        input.idempotencyKey
      )

      if (!artifact) {
        return {
          outcome: 'upload_required',
          access: 'Anyone with the link',
          provider: 'rudi_share_service',
          share: created.share,
          upload: created.upload,
        }
      }

      const published = await client.uploadArtifact(
        created.upload,
        artifact.tar
      )
      return {
        outcome: 'published',
        access: 'Anyone with the link',
        provider: 'rudi_share_service',
        share: published.share,
        artifact: artifact.manifest,
      }
    },

    async get(input: string | GetInput): Promise<GetResult> {
      const request = typeof input === 'string' ? { shareId: input } : input
      assertNonEmpty(request.shareId, 'share_id')
      const mode = resolveMode(request)
      if (mode.access === 'tailnet_private') {
        if (!dependencies.privatePreview) {
          throw new ShareWorkflowError(
            'PRIVATE_PROVIDER_NOT_CONFIGURED',
            'Tailnet-private preview provider is unavailable.'
          )
        }
        return dependencies.privatePreview.get(request.shareId)
      }
      const result = await publicClient().getShare(request.shareId)
      return {
        access: 'Anyone with the link',
        provider: 'rudi_share_service',
        share: result.share,
      }
    },

    async unpublish(input: UnpublishInput): Promise<UnpublishResult> {
      assertNonEmpty(input.shareId, 'share_id')
      assertNonEmpty(input.idempotencyKey, 'idempotency_key')
      const mode = resolveMode(input)
      if (!input.confirmUnpublish) {
        return {
          outcome: 'confirmation_required',
          access: mode.access === 'tailnet_private'
            ? 'Tailnet private'
            : 'Anyone with the link',
          provider: mode.provider,
          warning:
            mode.access === 'tailnet_private'
              ? 'Unpublishing immediately revokes the tailnet-private URL. Set confirm_unpublish to true only after the user approves revocation.'
              : 'Unpublishing immediately revokes the public URL. Set confirm_unpublish to true only after the user approves revocation.',
        }
      }
      if (mode.access === 'tailnet_private') {
        if (!dependencies.privatePreview) {
          throw new ShareWorkflowError(
            'PRIVATE_PROVIDER_NOT_CONFIGURED',
            'Tailnet-private preview provider is unavailable.'
          )
        }
        return dependencies.privatePreview.unpublish({
          previewId: input.shareId,
          idempotencyKey: input.idempotencyKey,
        })
      }
      const result = await publicClient().unpublish(
        input.shareId,
        input.idempotencyKey
      )
      return {
        outcome: 'unpublished',
        access: 'Anyone with the link',
        provider: 'rudi_share_service',
        share: result.share,
      }
    },
  }
}
