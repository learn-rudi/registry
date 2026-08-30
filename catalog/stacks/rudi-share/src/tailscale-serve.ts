import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

import {
  COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_HTTPS_PORT,
  MIN_HTTPS_PORT,
  PrivatePreviewError,
  type TailnetProvider,
  type TailnetRoute,
  isRecord,
  normalizeUrl,
  runtimeEnvironment,
} from './private-preview-contract.js'

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveTailscaleBinary(): Promise<string> {
  const pathCandidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, process.platform === 'win32' ? 'tailscale.exe' : 'tailscale'))
  const candidates = process.platform === 'darwin'
    ? [
        ...pathCandidates,
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      ]
    : pathCandidates
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate
  }
  throw new PrivatePreviewError(
    'TAILSCALE_NOT_FOUND',
    'Tailscale is not installed or its CLI is unavailable.'
  )
}

export interface CommandResult {
  stdout: string
  stderr: string
}

async function runTailscale(args: string[]): Promise<CommandResult> {
  const binary = await resolveTailscaleBinary()
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        env: runtimeEnvironment({ TAILSCALE_BE_CLI: '1' }),
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr })
          return
        }
        const combined = `${stdout}\n${stderr}`
        if (/approval|required.*enable|admin\/feature\/serve/i.test(combined)) {
          reject(
            new PrivatePreviewError(
              'TAILSCALE_SERVE_APPROVAL_REQUIRED',
              'Tailnet approval is required before Tailscale Serve can expose this preview.'
            )
          )
          return
        }
        reject(
          new PrivatePreviewError(
            'TAILSCALE_SERVE_FAILED',
            'Tailscale Serve could not complete the requested endpoint change.',
            true
          )
        )
      }
    )
  })
}

function parseJsonOutput(output: string): Record<string, unknown> {
  try {
    const value = JSON.parse(output) as unknown
    if (!isRecord(value)) throw new Error('invalid')
    return value
  } catch {
    throw new PrivatePreviewError(
      'TAILSCALE_INVALID_STATUS',
      'Tailscale returned invalid status data.',
      true
    )
  }
}

function serveStatusPort(value: string): number {
  const separator = value.lastIndexOf(':')
  const rawPort = separator === -1 ? value : value.slice(separator + 1)
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PrivatePreviewError(
      'TAILSCALE_INVALID_STATUS',
      'Tailscale returned invalid Serve status data.',
      true
    )
  }
  return port
}

function requiredStatusMap(
  config: Record<string, unknown>,
  field: string
): Record<string, unknown> | undefined {
  const value = config[field]
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) {
    throw new PrivatePreviewError(
      'TAILSCALE_INVALID_STATUS',
      'Tailscale returned invalid Serve status data.',
      true
    )
  }
  return value
}

export function createTailscaleServeProvider(options: {
  run?: (args: string[]) => Promise<CommandResult>
} = {}): TailnetProvider {
  const run = options.run ?? runTailscale
  return {
  async status() {
    const body = parseJsonOutput((await run(['status', '--json'])).stdout)
    const self = body.Self
    const online = body.BackendState === 'Running' && isRecord(self) && self.Online === true
    if (!online) {
      throw new PrivatePreviewError(
        'TAILSCALE_OFFLINE',
        'Tailscale is installed but this device is offline.',
        true
      )
    }
    const rawDnsName = isRecord(self) ? self.DNSName : null
    if (typeof rawDnsName !== 'string' || rawDnsName.length > 253) {
      throw new PrivatePreviewError(
        'TAILSCALE_INVALID_STATUS',
        'Tailscale did not report a valid device DNS name.',
        true
      )
    }
    const dnsName = rawDnsName.replace(/\.$/, '').toLowerCase()
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(dnsName)) {
      throw new PrivatePreviewError(
        'TAILSCALE_INVALID_STATUS',
        'Tailscale did not report a valid device DNS name.',
        true
      )
    }
    return { online: true, dnsName }
  },

  async listRoutes() {
    const body = parseJsonOutput(
      (await run(['serve', 'status', '--json'])).stdout
    )
    const routes = new Map<number, TailnetRoute>()
    const protectedPorts = new Set<number>()
    const webClaims = new Set<number>()
    const reserve = (port: number) => {
      if (!routes.has(port)) routes.set(port, { httpsPort: port, targetUrl: null })
    }
    const protect = (port: number) => {
      reserve(port)
      protectedPorts.add(port)
      routes.set(port, { httpsPort: port, targetUrl: null })
    }
    const inspectConfig = (
      config: Record<string, unknown>,
      protectedConfig: boolean,
      depth: number
    ): void => {
      if (depth > 8) {
        throw new PrivatePreviewError(
          'TAILSCALE_INVALID_STATUS',
          'Tailscale returned invalid Serve status data.',
          true
        )
      }
      const tcp = requiredStatusMap(config, 'TCP')
      for (const rawPort of Object.keys(tcp ?? {})) {
        const port = serveStatusPort(rawPort)
        if (protectedConfig) protect(port)
        else reserve(port)
      }

      const web = requiredStatusMap(config, 'Web')
      for (const [hostPort, webConfig] of Object.entries(web ?? {})) {
        const port = serveStatusPort(hostPort)
        if (protectedConfig) {
          protect(port)
          continue
        }
        if (!isRecord(webConfig) || !isRecord(webConfig.Handlers)) {
          throw new PrivatePreviewError(
            'TAILSCALE_INVALID_STATUS',
            'Tailscale returned invalid Serve status data.',
            true
          )
        }
        if (webClaims.has(port)) {
          protect(port)
          continue
        }
        webClaims.add(port)
        const handlers = Object.entries(webConfig.Handlers)
        const rootHandler = webConfig.Handlers['/']
        let targetUrl: string | null = null
        if (isRecord(rootHandler) && typeof rootHandler.Proxy === 'string') {
          try {
            targetUrl = normalizeUrl(rootHandler.Proxy)
          } catch {
            throw new PrivatePreviewError(
              'TAILSCALE_INVALID_STATUS',
              'Tailscale returned invalid Serve status data.',
              true
            )
          }
        }
        routes.set(port, {
          httpsPort: port,
          targetUrl: protectedPorts.has(port) ? null : targetUrl,
          handlerCount: protectedPorts.has(port) ? undefined : handlers.length,
        })
      }

      const funnel = requiredStatusMap(config, 'AllowFunnel')
      for (const hostPort of Object.keys(funnel ?? {})) {
        protect(serveStatusPort(hostPort))
      }

      const foreground = requiredStatusMap(config, 'Foreground')
      for (const nested of Object.values(foreground ?? {})) {
        if (!isRecord(nested)) {
          throw new PrivatePreviewError(
            'TAILSCALE_INVALID_STATUS',
            'Tailscale returned invalid Serve status data.',
            true
          )
        }
        inspectConfig(nested, true, depth + 1)
      }

      const services = requiredStatusMap(config, 'Services')
      for (const nested of Object.values(services ?? {})) {
        if (!isRecord(nested)) {
          throw new PrivatePreviewError(
            'TAILSCALE_INVALID_STATUS',
            'Tailscale returned invalid Serve status data.',
            true
          )
        }
        inspectConfig(nested, true, depth + 1)
      }
    }

    inspectConfig(body, false, 0)
    return [...routes.values()].sort((left, right) => left.httpsPort - right.httpsPort)
  },

  async serve(input) {
    if (input.httpsPort === 443) {
      throw new PrivatePreviewError(
        'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH',
        'RUDI Share will not modify the reserved HTTPS 443 route.'
      )
    }
    const target = new URL(input.targetUrl)
    if (
      target.protocol !== 'http:' ||
      target.hostname !== '127.0.0.1' ||
      target.username ||
      target.password ||
      target.pathname !== '/'
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_SERVE_FAILED',
        'Private preview target must be a loopback HTTP endpoint.'
      )
    }
    await run([
      'serve',
      '--bg',
      `--https=${input.httpsPort}`,
      normalizeUrl(input.targetUrl),
    ])
    const route = (await this.listRoutes()).find(
      (candidate) => candidate.httpsPort === input.httpsPort
    )
    if (
      !route ||
      route.targetUrl !== normalizeUrl(input.targetUrl) ||
      route.handlerCount !== 1
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_SERVE_FAILED',
        'Tailscale Serve did not report the expected private preview route.',
        true
      )
    }
    const status = await this.status()
    return { url: `https://${status.dnsName}:${input.httpsPort}/` }
  },

  async revoke(input) {
    if (input.httpsPort === 443) {
      throw new PrivatePreviewError(
        'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH',
        'RUDI Share will not modify the reserved HTTPS 443 route.'
      )
    }
    const route = (await this.listRoutes()).find(
      (candidate) => candidate.httpsPort === input.httpsPort
    )
    if (!route) return
    if (
      route.targetUrl !== normalizeUrl(input.targetUrl) ||
      route.handlerCount !== 1
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_ROUTE_OWNERSHIP_MISMATCH',
        'The live Serve route does not match the saved private preview receipt.'
      )
    }
    await run(['serve', `--https=${input.httpsPort}`, 'off'])
    if (
      (await this.listRoutes()).some(
        (candidate) => candidate.httpsPort === input.httpsPort
      )
    ) {
      throw new PrivatePreviewError(
        'TAILSCALE_SERVE_FAILED',
        'Tailscale Serve did not revoke the private preview route.',
        true
      )
    }
  },
  }
}

export const defaultTailnetProvider: TailnetProvider = createTailscaleServeProvider()

export function chooseHttpsPort(routes: TailnetRoute[]): number {
  const occupied = new Set(routes.map((route) => route.httpsPort))
  for (let port = MIN_HTTPS_PORT; port <= MAX_HTTPS_PORT; port += 1) {
    if (port !== 443 && !occupied.has(port)) return port
  }
  throw new PrivatePreviewError(
    'TAILSCALE_PORT_EXHAUSTED',
    'No private preview HTTPS port is available.',
    true
  )
}
