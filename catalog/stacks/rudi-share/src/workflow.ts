import { packStaticArtifact, type PackedStaticArtifact } from './artifact.js'
import {
  createRudiShareClient,
  type ShareResponse,
  type ShareSummary,
  type UploadSession,
} from './client.js'

type ShareClient = Pick<
  ReturnType<typeof createRudiShareClient>,
  'createShare' | 'uploadArtifact' | 'getShare' | 'unpublish'
>

export interface ShareWorkflowDependencies {
  client: ShareClient
  packArtifact?: (artifactPath: string) => Promise<PackedStaticArtifact>
}

export interface PublishInput {
  name: string
  idempotencyKey: string
  confirmPublication: boolean
  artifactPath?: string
}

export interface UnpublishInput {
  shareId: string
  idempotencyKey: string
  confirmUnpublish: boolean
}

export type PublishResult =
  | {
      outcome: 'confirmation_required'
      access: 'Anyone with the link'
      warning: string
    }
  | {
      outcome: 'upload_required'
      access: 'Anyone with the link'
      share: ShareSummary
      upload: UploadSession
    }
  | {
      outcome: 'published'
      access: 'Anyone with the link'
      share: ShareSummary
      artifact: PackedStaticArtifact['manifest']
    }

export type UnpublishResult =
  | {
      outcome: 'confirmation_required'
      warning: string
    }
  | {
      outcome: 'unpublished'
      share: ShareSummary
    }

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} is required.`)
}

export function createShareWorkflow(dependencies: ShareWorkflowDependencies) {
  const packArtifact = dependencies.packArtifact ?? packStaticArtifact

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      assertNonEmpty(input.name, 'name')
      assertNonEmpty(input.idempotencyKey, 'idempotency_key')
      if (!input.confirmPublication) {
        return {
          outcome: 'confirmation_required',
          access: 'Anyone with the link',
          warning:
            'Publishing creates a forwardable public URL. Set confirm_publication to true only after the user approves Anyone with the link access.',
        }
      }

      // Validate and package before allocating a remote share when local access exists.
      const artifact = input.artifactPath
        ? await packArtifact(input.artifactPath)
        : null
      const created = await dependencies.client.createShare(
        input.name,
        input.idempotencyKey
      )

      if (!artifact) {
        return {
          outcome: 'upload_required',
          access: 'Anyone with the link',
          share: created.share,
          upload: created.upload,
        }
      }

      const published = await dependencies.client.uploadArtifact(
        created.upload,
        artifact.tar
      )
      return {
        outcome: 'published',
        access: 'Anyone with the link',
        share: published.share,
        artifact: artifact.manifest,
      }
    },

    async get(shareId: string): Promise<ShareResponse> {
      assertNonEmpty(shareId, 'share_id')
      return dependencies.client.getShare(shareId)
    },

    async unpublish(input: UnpublishInput): Promise<UnpublishResult> {
      assertNonEmpty(input.shareId, 'share_id')
      assertNonEmpty(input.idempotencyKey, 'idempotency_key')
      if (!input.confirmUnpublish) {
        return {
          outcome: 'confirmation_required',
          warning:
            'Unpublishing immediately revokes the public URL. Set confirm_unpublish to true only after the user approves revocation.',
        }
      }
      const result = await dependencies.client.unpublish(
        input.shareId,
        input.idempotencyKey
      )
      return { outcome: 'unpublished', share: result.share }
    },
  }
}
