import { rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import {
  ArtifactPackagingError,
  materializeStaticArtifact,
  type ArtifactManifest,
  type MaterializedStaticArtifact,
} from './artifact.js'
import {
  type CreatePrivatePreviewServiceOptions,
  DEFAULT_STATE_ROOT,
  type HostIdentity,
  type PrivatePreviewArtifact,
  type PrivatePreviewErrorCode,
  type PrivatePreviewGetResult,
  PrivatePreviewError,
  type PrivatePreviewPublishResult,
  type PrivatePreviewRecord,
  type PrivatePreviewUnpublishResult,
  previewIdFor,
  readState,
  summarize,
  validHostIdentity,
  validTailnetUrl,
  withStateLock,
  writeState,
} from './private-preview-contract.js'
import {
  allocateLoopbackPort,
  checkManagedPreviewHealth,
  defaultHostController,
} from './private-preview-host.js'
import {
  chooseHttpsPort,
  defaultTailnetProvider,
} from './tailscale-serve.js'

function artifactSummary(
  sourcePath: string,
  manifest: ArtifactManifest
): PrivatePreviewArtifact {
  return {
    sourcePath,
    sha256: manifest.sha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
  }
}

export function createPrivatePreviewService(
  options: CreatePrivatePreviewServiceOptions = {}
) {
  const stateRoot = options.stateRoot ?? DEFAULT_STATE_ROOT
  if (!isAbsolute(stateRoot)) {
    throw new PrivatePreviewError(
      'PREVIEW_STATE_INVALID',
      'Private preview state root must be absolute.'
    )
  }
  const now = options.now ?? (() => new Date())
  const materializeArtifact = options.materializeArtifact ?? materializeStaticArtifact
  const allocatePort = options.allocateLoopbackPort ?? allocateLoopbackPort
  const host = options.host ?? defaultHostController
  const tailscale = options.tailscale ?? defaultTailnetProvider
  const removeArtifact = options.removeArtifact ??
    ((path: string) => rm(path, { recursive: true, force: true }))
  const checkTailnetHealth = options.checkTailnetHealth ??
    ((url, expected) => checkManagedPreviewHealth(url, expected))

  const refreshRecordHealth = async (
    record: PrivatePreviewRecord
  ): Promise<void> => {
    if (record.status === 'revoked') return
    const cleanupRequired =
      record.lifecycle === 'starting' ||
      record.lifecycle === 'cleanup_required'
    if (cleanupRequired) {
      const checkedAt = now().toISOString()
      const failureCode =
        record.lastHealth.failureCode === 'PARTIAL_REVOCATION_CLEANUP_FAILED'
          ? 'PARTIAL_REVOCATION_CLEANUP_FAILED'
          : 'PARTIAL_STARTUP_CLEANUP_FAILED'
      record.lifecycle = 'cleanup_required'
      record.status = 'degraded'
      record.updatedAt = checkedAt
      record.lastHealth = {
        ...record.lastHealth,
        status: 'degraded',
        checkedAt,
        failureCode,
      }
      return
    }
    if (record.hostPid === null) {
      throw new PrivatePreviewError(
        'PREVIEW_STATE_INVALID',
        'Private preview state is invalid.'
      )
    }
    const expected = {
      previewId: record.id,
      artifactSha256: record.artifact.sha256,
      pid: record.hostPid,
    }
    const loopback = await host.check({
      ...expected,
      port: record.loopbackPort,
      url: record.targetUrl,
    })
    let tailnetIdentityFailure: string | null = null
    let trustedTailnetUrl = false
    if (loopback) {
      try {
        const currentTailnet = await tailscale.status()
        if (!currentTailnet.online) {
          tailnetIdentityFailure = 'TAILSCALE_OFFLINE'
        } else if (
          currentTailnet.dnsName !== record.tailnetDnsName ||
          !validTailnetUrl(
            record.url,
            currentTailnet.dnsName,
            record.httpsPort
          )
        ) {
          tailnetIdentityFailure = 'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH'
        } else {
          trustedTailnetUrl = true
        }
      } catch (error) {
        tailnetIdentityFailure = error instanceof PrivatePreviewError
          ? error.code
          : 'TAILSCALE_OFFLINE'
      }
    }
    const tailnet = loopback && trustedTailnetUrl
      ? await checkTailnetHealth(record.url, expected).catch(() => false)
      : false
    const checkedAt = now().toISOString()
    const failureCode = !loopback
        ? 'STALE_PREVIEW_PROCESS'
        : tailnetIdentityFailure
          ? tailnetIdentityFailure
          : !tailnet
            ? 'PREVIEW_HEALTH_CHECK_FAILED'
            : null
    record.status = failureCode ? 'degraded' : 'healthy'
    record.updatedAt = checkedAt
    record.lastHealth = {
      status: record.status,
      loopback,
      tailnet,
      checkedAt,
      failureCode,
    }
  }

  return {
    async publish(input: {
      name: string
      idempotencyKey: string
      artifactPath: string
    }): Promise<PrivatePreviewPublishResult> {
      if (!input.name.trim() || !input.idempotencyKey.trim()) {
        throw new PrivatePreviewError(
          'PREVIEW_STATE_INVALID',
          'Private preview name and idempotency key are required.'
        )
      }
      if (!isAbsolute(input.artifactPath)) {
        throw new PrivatePreviewError(
          'PREVIEW_STATE_INVALID',
          'Private preview artifact_path must be absolute.'
        )
      }
      const previewId = previewIdFor(input.idempotencyKey)
      return withStateLock(stateRoot, async () => {
        const state = await readState(stateRoot)
        const existing = state.previews[previewId]
        if (existing) {
          if (
            existing.name === input.name &&
            existing.artifact.sourcePath === input.artifactPath &&
            existing.status !== 'revoked'
          ) {
            if (existing.lifecycle !== 'active') {
              const cleanupFailureCode =
                existing.lastHealth.failureCode ===
                'PARTIAL_REVOCATION_CLEANUP_FAILED'
                  ? 'PARTIAL_REVOCATION_CLEANUP_FAILED'
                  : 'PARTIAL_STARTUP_CLEANUP_FAILED'
              throw new PrivatePreviewError(
                cleanupFailureCode,
                'Private preview cleanup is required before this publication can be retried.',
                false,
                {
                  previewId: existing.id,
                  access: 'Tailnet private',
                  provider: 'tailscale_serve',
                  failureCode: cleanupFailureCode,
                  httpsPort: existing.httpsPort,
                  targetUrl: existing.targetUrl,
                  hostPid: existing.hostPid,
                  artifactSha256: existing.artifact.sha256,
                  status: existing.lifecycle,
                  supportedAction: 'rudi_share_unpublish',
                }
              )
            }
            await refreshRecordHealth(existing)
            await writeState(stateRoot, state)
            return {
              outcome: 'published',
              access: 'Tailnet private',
              provider: 'tailscale_serve',
              preview: summarize(existing),
            }
          }
          throw new PrivatePreviewError(
            'PREVIEW_IDEMPOTENCY_CONFLICT',
            'The private preview idempotency key is already bound to another operation.'
          )
        }

        const tailnetStatus = await tailscale.status()
        if (!tailnetStatus.online) {
          throw new PrivatePreviewError(
            'TAILSCALE_OFFLINE',
            'Tailscale is installed but this device is offline.',
            true
          )
        }
        const persistedRoutes = Object.values(state.previews)
          .filter((preview) => preview.status !== 'revoked')
          .map((preview) => ({
            httpsPort: preview.httpsPort,
            targetUrl: preview.targetUrl,
          }))
        const httpsPort = chooseHttpsPort([
          ...await tailscale.listRoutes(),
          ...persistedRoutes,
        ])
        const previewDirectory = join(stateRoot, 'previews', previewId)
        const artifactDirectory = join(previewDirectory, 'artifact')
        let materialized: MaterializedStaticArtifact | undefined
        let loopbackPort: number | undefined
        let hostReceipt: HostIdentity | undefined
        let routeReceipt: { url: string } | undefined
        let serveAttempted = false
        let journaled = false
        let record: PrivatePreviewRecord | undefined
        const timestamp = now().toISOString()

        try {
          loopbackPort = await allocatePort()
          materialized = await materializeArtifact(
            input.artifactPath,
            artifactDirectory
          )
          const materializedArtifact = materialized
          const journalHostOwnership = async (startedHost: HostIdentity) => {
            if (
              !validHostIdentity(startedHost) ||
              startedHost.port !== loopbackPort
            ) {
              throw new PrivatePreviewError(
                'PREVIEW_HOST_START_FAILED',
                'The loopback preview host returned an invalid identity.'
              )
            }
            hostReceipt = startedHost
            record = {
              id: previewId,
              name: input.name,
              lifecycle: 'starting',
              status: 'degraded',
              url: `https://${tailnetStatus.dnsName}:${httpsPort}/`,
              httpsPort,
              loopbackPort: startedHost.port,
              hostPid: startedHost.pid,
              targetUrl: startedHost.url,
              tailnetDnsName: tailnetStatus.dnsName,
              artifact: artifactSummary(
                input.artifactPath,
                materializedArtifact.manifest
              ),
              createdAt: timestamp,
              updatedAt: timestamp,
              revokedAt: null,
              lastHealth: {
                status: 'degraded',
                loopback: false,
                tailnet: false,
                checkedAt: timestamp,
                failureCode: 'PREVIEW_STARTING',
              },
              revocationReceipt: null,
            }
            state.previews[previewId] = record
            await writeState(stateRoot, state)
            journaled = true
          }
          const startedHost = await host.start(
            {
              artifactRoot: materializedArtifact.root,
              previewId,
              artifactSha256: materializedArtifact.manifest.sha256,
              port: loopbackPort,
            },
            { beforeDetach: journalHostOwnership }
          )
          if (!journaled) await journalHostOwnership(startedHost)
          const expected = {
            previewId,
            artifactSha256: materializedArtifact.manifest.sha256,
            pid: startedHost.pid,
          }
          if (!(await host.check({ ...startedHost, ...expected }))) {
            throw new PrivatePreviewError(
              'PREVIEW_HEALTH_CHECK_FAILED',
              'The loopback preview host failed its readiness check.',
              true
            )
          }
          serveAttempted = true
          routeReceipt = await tailscale.serve({
            httpsPort,
            targetUrl: startedHost.url,
          })
          if (
            !validTailnetUrl(
              routeReceipt.url,
              tailnetStatus.dnsName,
              httpsPort
            )
          ) {
            throw new PrivatePreviewError(
              'TAILSCALE_SERVE_FAILED',
              'Tailscale Serve returned an invalid private preview URL.'
            )
          }
          if (!(await checkTailnetHealth(routeReceipt.url, expected))) {
            throw new PrivatePreviewError(
              'PREVIEW_HEALTH_CHECK_FAILED',
              'The tailnet-private URL failed its health check.',
              true
            )
          }

          const activeRecord = record
          if (!activeRecord) {
            throw new PrivatePreviewError(
              'PREVIEW_STATE_INVALID',
              'Private preview ownership journal is missing.'
            )
          }
          activeRecord.lifecycle = 'active'
          activeRecord.status = 'healthy'
          activeRecord.url = routeReceipt.url
          activeRecord.updatedAt = now().toISOString()
          activeRecord.lastHealth = {
            status: 'healthy',
            loopback: true,
            tailnet: true,
            checkedAt: activeRecord.updatedAt,
            failureCode: null,
          }
          await writeState(stateRoot, state)
          return {
            outcome: 'published',
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            preview: summarize(activeRecord),
          }
        } catch (error) {
          const failedHostPid =
            error instanceof PrivatePreviewError &&
            error.receipt &&
            Number.isSafeInteger(error.receipt.hostPid) &&
            Number(error.receipt.hostPid) > 0
              ? Number(error.receipt.hostPid)
              : undefined
          const ownedHost = hostReceipt ?? (
            failedHostPid !== undefined && loopbackPort !== undefined
              ? {
                  pid: failedHostPid,
                  port: loopbackPort,
                  url: `http://127.0.0.1:${loopbackPort}/`,
                }
              : undefined
          )
          const cleanupLoopbackPort = ownedHost?.port ?? loopbackPort
          const cleanupTargetUrl = ownedHost?.url ?? (
            cleanupLoopbackPort === undefined
              ? null
              : `http://127.0.0.1:${cleanupLoopbackPort}/`
          )
          let routeRevoked = !serveAttempted
          let hostStopped = ownedHost === undefined
          let staleProcess = false
          if (serveAttempted && ownedHost) {
            try {
              await tailscale.revoke({
                httpsPort,
                targetUrl: ownedHost.url,
              })
              routeRevoked = true
            } catch {
              routeRevoked = false
            }
          }
          if (ownedHost && materialized) {
            try {
              const stopped = await host.stop({
                ...ownedHost,
                previewId,
                artifactSha256: materialized.manifest.sha256,
              })
              hostStopped = stopped.stopped
              staleProcess = stopped.stale
            } catch {
              hostStopped = false
            }
          }
          let artifactRemoved = materialized === undefined
          if (routeRevoked && hostStopped) {
            try {
              await removeArtifact(previewDirectory)
              artifactRemoved = true
            } catch {
              artifactRemoved = false
            }
            if (artifactRemoved && journaled) {
              delete state.previews[previewId]
              await writeState(stateRoot, state)
            }
          }
          const receipt = {
            previewId,
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            failureCode: error instanceof PrivatePreviewError
              ? error.code
              : 'PREVIEW_HOST_START_FAILED',
            routeRevoked,
            hostStopped,
            artifactRemoved,
            staleProcess,
            httpsPort,
            targetUrl: cleanupTargetUrl,
            hostPid: ownedHost?.pid ?? null,
            artifactSha256: materialized?.manifest.sha256 ?? null,
            runtimeRoot: materialized?.root ?? null,
            timestamp: now().toISOString(),
            supportedAction: 'rudi_share_unpublish',
          }
          if (!routeRevoked || !hostStopped || !artifactRemoved) {
            if (
              materialized &&
              cleanupLoopbackPort !== undefined &&
              cleanupTargetUrl !== null
            ) {
              const cleanupRecord = record ?? {
                id: previewId,
                name: input.name,
                lifecycle: 'cleanup_required' as const,
                status: 'degraded' as const,
                url: `https://${tailnetStatus.dnsName}:${httpsPort}/`,
                httpsPort,
                loopbackPort: cleanupLoopbackPort,
                hostPid: ownedHost?.pid ?? null,
                targetUrl: cleanupTargetUrl,
                tailnetDnsName: tailnetStatus.dnsName,
                artifact: artifactSummary(
                  input.artifactPath,
                  materialized.manifest
                ),
                createdAt: timestamp,
                updatedAt: receipt.timestamp,
                revokedAt: null,
                lastHealth: {
                  status: 'degraded' as const,
                  loopback: ownedHost !== undefined && !hostStopped,
                  tailnet: !routeRevoked,
                  checkedAt: receipt.timestamp,
                  failureCode: 'PARTIAL_STARTUP_CLEANUP_FAILED',
                },
                revocationReceipt: null,
              }
              cleanupRecord.lifecycle = 'cleanup_required'
              cleanupRecord.status = 'degraded'
              cleanupRecord.updatedAt = receipt.timestamp
              cleanupRecord.lastHealth = {
                status: 'degraded',
                loopback: ownedHost !== undefined && !hostStopped,
                tailnet: !routeRevoked,
                checkedAt: receipt.timestamp,
                failureCode: 'PARTIAL_STARTUP_CLEANUP_FAILED',
              }
              state.previews[previewId] = cleanupRecord
              await writeState(stateRoot, state)
            }
            throw new PrivatePreviewError(
              'PARTIAL_STARTUP_CLEANUP_FAILED',
              'Private preview startup failed and exact cleanup is incomplete.',
              false,
              receipt
            )
          }
          if (error instanceof PrivatePreviewError) {
            throw new PrivatePreviewError(
              error.code,
              error.message,
              error.retryable,
              receipt
            )
          }
          if (error instanceof ArtifactPackagingError) {
            throw new PrivatePreviewError(
              error.code,
              error.message,
              false,
              receipt
            )
          }
          throw new PrivatePreviewError(
            'PREVIEW_HOST_START_FAILED',
            'Private preview startup failed safely.',
            true,
            receipt
          )
        }
      })
    },

    async get(previewId: string): Promise<PrivatePreviewGetResult> {
      if (!/^private_[a-f0-9]{20}$/.test(previewId)) {
        throw new PrivatePreviewError(
          'PREVIEW_NOT_FOUND',
          'Private preview was not found.'
        )
      }
      return withStateLock(stateRoot, async () => {
        const state = await readState(stateRoot)
        const record = state.previews[previewId]
        if (!record) {
          throw new PrivatePreviewError(
            'PREVIEW_NOT_FOUND',
            'Private preview was not found.'
          )
        }
        if (record.status === 'revoked') {
          return {
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            preview: summarize(record),
          }
        }

        await refreshRecordHealth(record)
        await writeState(stateRoot, state)
        return {
          access: 'Tailnet private',
          provider: 'tailscale_serve',
          preview: summarize(record),
        }
      })
    },

    async unpublish(input: {
      previewId: string
      idempotencyKey: string
    }): Promise<PrivatePreviewUnpublishResult> {
      if (
        !/^private_[a-f0-9]{20}$/.test(input.previewId) ||
        !input.idempotencyKey.trim()
      ) {
        throw new PrivatePreviewError(
          'PREVIEW_NOT_FOUND',
          'Private preview was not found.'
        )
      }
      return withStateLock(stateRoot, async () => {
        const state = await readState(stateRoot)
        const record = state.previews[input.previewId]
        if (!record) {
          throw new PrivatePreviewError(
            'PREVIEW_NOT_FOUND',
            'Private preview was not found.'
          )
        }
        if (record.status === 'revoked') {
          let receipt = record.revocationReceipt
          let cleanupAttempted = false
          if (!receipt) {
            throw new PrivatePreviewError(
              'PREVIEW_STATE_INVALID',
              'Private preview state is invalid.'
            )
          }
          if (!receipt.hostStopped) {
            cleanupAttempted = true
            const stopped = record.hostPid === null
              ? { stopped: true, stale: false }
              : await host.stop({
                  previewId: record.id,
                  artifactSha256: record.artifact.sha256,
                  pid: record.hostPid,
                  port: record.loopbackPort,
                  url: record.targetUrl,
                })
            receipt = {
              ...receipt,
              hostStopped: stopped.stopped,
              staleProcess: stopped.stale,
            }
            record.revocationReceipt = receipt
          }
          if (receipt.hostStopped && !receipt.artifactRemoved) {
            cleanupAttempted = true
            try {
              await removeArtifact(join(stateRoot, 'previews', record.id))
              receipt = { ...receipt, artifactRemoved: true }
            } catch {
              receipt = { ...receipt, artifactRemoved: false }
            }
            record.revocationReceipt = receipt
          }
          record.lastHealth.failureCode = !receipt.hostStopped
            ? 'STALE_PREVIEW_PROCESS'
            : !receipt.artifactRemoved
              ? 'PREVIEW_ARTIFACT_CLEANUP_FAILED'
              : null
          if (cleanupAttempted) {
            const checkedAt = now().toISOString()
            record.updatedAt = checkedAt
            record.lastHealth.checkedAt = checkedAt
          }
          await writeState(stateRoot, state)
          return {
            outcome: 'unpublished',
            access: 'Tailnet private',
            provider: 'tailscale_serve',
            preview: summarize(record),
            receipt,
          }
        }

        let routeRevoked = record.hostPid === null
        let routeFailureCode: PrivatePreviewErrorCode | null = null
        if (record.hostPid !== null) {
          try {
            await tailscale.revoke({
              httpsPort: record.httpsPort,
              targetUrl: record.targetUrl,
            })
            routeRevoked = true
          } catch (error) {
            routeFailureCode = error instanceof PrivatePreviewError
              ? error.code
              : 'TAILSCALE_SERVE_FAILED'
          }
        }
        let stopped = { stopped: record.hostPid === null, stale: false }
        if (record.hostPid !== null) {
          try {
            stopped = await host.stop({
              previewId: record.id,
              artifactSha256: record.artifact.sha256,
              pid: record.hostPid,
              port: record.loopbackPort,
              url: record.targetUrl,
            })
          } catch {
            stopped = { stopped: false, stale: true }
          }
        }
        const revokedAt = now().toISOString()
        let artifactRemoved = false
        if (stopped.stopped) {
          try {
            await removeArtifact(join(stateRoot, 'previews', record.id))
            artifactRemoved = true
          } catch {
            artifactRemoved = false
          }
        }
        if (!routeRevoked || !stopped.stopped) {
          record.status = 'degraded'
          record.lifecycle = 'cleanup_required'
          record.revokedAt = null
          record.updatedAt = revokedAt
          record.revocationReceipt = null
          record.lastHealth = {
            status: 'degraded',
            loopback: !stopped.stopped,
            tailnet: !routeRevoked,
            checkedAt: revokedAt,
            failureCode: 'PARTIAL_REVOCATION_CLEANUP_FAILED',
          }
          await writeState(stateRoot, state)
          throw new PrivatePreviewError(
            'PARTIAL_REVOCATION_CLEANUP_FAILED',
            'Private preview revocation is incomplete; retry the exact unpublish operation.',
            false,
            {
              previewId: record.id,
              access: 'Tailnet private',
              provider: 'tailscale_serve',
              failureCode: routeFailureCode ?? 'STALE_PREVIEW_PROCESS',
              routeRevoked,
              hostStopped: stopped.stopped,
              artifactRemoved,
              staleProcess: stopped.stale,
              httpsPort: record.httpsPort,
              targetUrl: record.targetUrl,
              hostPid: record.hostPid,
              artifactSha256: record.artifact.sha256,
              runtimeRoot: join(stateRoot, 'previews', record.id),
              timestamp: revokedAt,
              supportedAction: 'rudi_share_unpublish',
            }
          )
        }
        record.status = 'revoked'
        record.lifecycle = 'revoked'
        record.revokedAt = revokedAt
        record.updatedAt = revokedAt
        record.lastHealth = {
          status: 'revoked',
          loopback: false,
          tailnet: false,
          checkedAt: revokedAt,
          failureCode: !stopped.stopped
            ? 'STALE_PREVIEW_PROCESS'
            : !artifactRemoved
              ? 'PREVIEW_ARTIFACT_CLEANUP_FAILED'
              : null,
        }
        const receipt = {
          routeRevoked: true,
          hostStopped: stopped.stopped,
          artifactRemoved,
          staleProcess: stopped.stale,
          revokedAt,
        }
        record.revocationReceipt = receipt
        await writeState(stateRoot, state)
        return {
          outcome: 'unpublished',
          access: 'Tailnet private',
          provider: 'tailscale_serve',
          preview: summarize(record),
          receipt,
        }
      })
    },
  }
}
