import type { DashboardStats, ServerStatus } from '@shared/types/dashboard'
import { DEFAULT_SERVER_PORT } from '@shared/constants/app'
import {
  getPreferredLanAddress,
  listLocalIpv4Addresses
} from '../network/local-ips'
import { ensurePortAvailable } from '../network/ensure-port'

/**
 * Runtime serveur — Express + Socket.IO + stockage JSON local.
 */
class ServerRuntime {
  private running = false
  private startedAt: string | null = null
  private readonly port = Number(process.env.JUDVAC_SERVER_PORT ?? DEFAULT_SERVER_PORT)
  private dbReady = false

  async start(): Promise<void> {
    if (this.running) {
      await this.stop()
    }

    await ensurePortAvailable(this.port)

    const { bootstrapServer } = await import('@server/bootstrap')
    const { getContainer } = await import('@server/container')
    await bootstrapServer({ host: '0.0.0.0', port: this.port })
    this.dbReady = getContainer().dbReady
    this.running = true
    this.startedAt = new Date().toISOString()
  }

  async stop(): Promise<void> {
    if (!this.running) return
    const { shutdownServer } = await import('@server/bootstrap')
    await shutdownServer()
    this.running = false
    this.startedAt = null
    this.dbReady = false
  }

  getStatus(): ServerStatus {
    const localAddresses = listLocalIpv4Addresses()
    return {
      running: this.running,
      host: '0.0.0.0',
      port: this.port,
      startedAt: this.startedAt,
      connectedClients: this.running ? this.readClients() : [],
      dbReady: this.dbReady,
      dbBackend: 'json',
      localAddresses,
      preferredAddress: getPreferredLanAddress(localAddresses)
    }
  }

  private readClients(): ServerStatus['connectedClients'] {
    try {
      const mod = require('@server/client-registry') as {
        clientRegistry: { list: () => ServerStatus['connectedClients'] }
      }
      return mod.clientRegistry.list()
    } catch {
      return []
    }
  }

  async getDashboardStats(): Promise<DashboardStats> {
    if (!this.running) {
      return {
        totalJudokas: 0,
        connectedClients: 0,
        networkStatus: 'offline',
        pendingSyncCount: 0,
        lastSyncAt: null,
        recentLogs: [],
        userActivity: [],
        judokaByUser: []
      }
    }

    try {
      const { getContainer } = await import('@server/container')
      const { clientRegistry } = await import('@server/client-registry')
      const c = getContainer()
      this.dbReady = c.dbReady
      const total = await c.getJudokaStats.execute()
      const judokaByUser = mergeJudokaByUser(
        c.judokaRepo && 'countByUser' in c.judokaRepo
          ? (c.judokaRepo as { countByUser(): Array<{ username: string; count: number }> }).countByUser()
          : [],
        [
          ...clientRegistry.list().map((cl) => cl.username),
          ...c.userAccounts.list().map((u) => u.username)
        ]
      )
      return {
        totalJudokas: total.total,
        connectedClients: clientRegistry.size(),
        networkStatus: 'online',
        pendingSyncCount: 0,
        lastSyncAt: null,
        recentLogs: [],
        userActivity: [],
        judokaByUser
      }
    } catch {
      return {
        totalJudokas: 0,
        connectedClients: 0,
        networkStatus: 'degraded',
        pendingSyncCount: 0,
        lastSyncAt: null,
        recentLogs: [],
        userActivity: [],
        judokaByUser: []
      }
    }
  }
}

const singleton = new ServerRuntime()

export function getServerRuntime(): ServerRuntime {
  return singleton
}

export async function startServerRuntime(): Promise<void> {
  await singleton.start()
}

export async function stopServerRuntime(): Promise<void> {
  await singleton.stop()
}

function mergeJudokaByUser(
  stats: Array<{ username: string; count: number }>,
  connectedUsernames: string[]
): Array<{ username: string; count: number }> {
  const map = new Map(stats.map((s) => [s.username, s.count]))
  if (!map.has('Serveur')) map.set('Serveur', 0)
  for (const username of connectedUsernames) {
    const trimmed = username.trim()
    if (trimmed && !map.has(trimmed)) map.set(trimmed, 0)
  }
  const entries = [...map.entries()].map(([username, count]) => ({ username, count }))
  entries.sort((a, b) => {
    if (a.username === 'Serveur') return -1
    if (b.username === 'Serveur') return 1
    return a.username.localeCompare(b.username, 'fr')
  })
  return entries
}
