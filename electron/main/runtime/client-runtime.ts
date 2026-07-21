import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import type { ClientConnectionStatus, DashboardStats } from '@shared/types/dashboard'
import { DEFAULT_SERVER_PORT } from '@shared/constants/app'
import { SyncQueue, type QueueItem } from '@core/infrastructure/sync/sync-queue'
import { flushSyncQueue } from '@core/infrastructure/sync/flush-queue'

export interface ClientConnectOptions {
  username: string
  workstation: string
  serverHost: string
  serverPort: number
}

export interface EnqueueResult {
  queueId: string
  queueSize: number
  /** true si l’élément a déjà été envoyé au serveur */
  synced: boolean
  connected: boolean
  lastError: string | null
}

/**
 * Runtime client — file JSON persistante + sync auto / forcée vers le serveur.
 * Fonctionne hors-ligne : les données restent sur le disque jusqu’à sync réussie.
 */
class ClientRuntime {
  private queue: SyncQueue | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private connectOpts: ClientConnectOptions | null = null
  private flushInFlight: Promise<void> | null = null
  private status: ClientConnectionStatus = {
    connected: false,
    serverHost: null,
    serverPort: null,
    lastError: null,
    queueSize: 0,
    lastSyncAt: null,
    lastFlushSent: 0,
    lastFlushFailed: 0
  }

  private ensureQueue(): SyncQueue {
    if (!this.queue) {
      this.queue = new SyncQueue(app.getPath('userData'))
      this.status.queueSize = this.queue.size()
    }
    return this.queue
  }

  /**
   * Démarre le client. Si le serveur est injoignable, le mode Client reste actif
   * avec stockage local (file) — la sync reprend dès que le réseau revient.
   */
  async connect(opts: ClientConnectOptions): Promise<void> {
    this.connectOpts = opts
    this.ensureQueue()
    this.status = {
      connected: false,
      serverHost: opts.serverHost,
      serverPort: opts.serverPort || DEFAULT_SERVER_PORT,
      lastError: null,
      queueSize: this.queue!.size(),
      lastSyncAt: null,
      lastFlushSent: 0,
      lastFlushFailed: 0
    }

    await this.tryConnect()
    if (!this.status.connected) {
      this.stopAutoFlush()
      const { disconnectFromServer } = await import('@server/client/socket-client')
      await disconnectFromServer()
      throw new Error(
        this.status.lastError ??
          'Le serveur doit être joignable pour valider votre identifiant utilisateur.'
      )
    }
    this.startAutoFlush()
    await this.flush()
  }

  async disconnect(): Promise<void> {
    this.stopAutoFlush()
    const { disconnectFromServer } = await import('@server/client/socket-client')
    await disconnectFromServer()
    this.status.connected = false
    this.connectOpts = null
  }

  /** Réinjecte les options de connexion (ex. après redémarrage / force sync). */
  setConnectOptions(opts: ClientConnectOptions): void {
    this.connectOpts = opts
    this.status.serverHost = opts.serverHost
    this.status.serverPort = opts.serverPort || DEFAULT_SERVER_PORT
  }

  /** Enfile un create/update puis tente un envoi immédiat au serveur. */
  async enqueueJudoka(payload: unknown, force = false): Promise<EnqueueResult> {
    const q = this.ensureQueue()
    const enriched = enrichPayloadWithPhoto(payload) as Record<string, unknown>
    // ID stable pour create-or-update côté serveur
    if (typeof enriched.id !== 'string' || !enriched.id.trim()) {
      enriched.id = randomUUID()
    }
    delete enriched.force
    const item = q.enqueue('upsert', enriched, force)
    this.status.queueSize = q.size()

    await this.tryConnect()
    await this.flush()

    const stillQueued = q.list().some((i) => i.id === item.id)
    return {
      queueId: item.id,
      queueSize: q.size(),
      synced: !stillQueued,
      connected: this.status.connected,
      lastError: this.status.lastError
    }
  }

  async enqueueDelete(id: string, actor?: string): Promise<EnqueueResult> {
    const q = this.ensureQueue()
    const item = q.enqueue('delete', { id, actor })
    this.status.queueSize = q.size()

    await this.tryConnect()
    await this.flush()

    const stillQueued = q.list().some((i) => i.id === item.id)
    return {
      queueId: item.id,
      queueSize: q.size(),
      synced: !stillQueued,
      connected: this.status.connected,
      lastError: this.status.lastError
    }
  }

  /**
   * Force la synchronisation : reconnecte si besoin, puis vide la file.
   */
  async flush(forceReconnect = false): Promise<ClientConnectionStatus> {
    if (this.flushInFlight) {
      await this.flushInFlight
      return this.getStatus()
    }

    this.flushInFlight = this.doFlush(forceReconnect)
    try {
      await this.flushInFlight
    } finally {
      this.flushInFlight = null
    }
    return this.getStatus()
  }

  /**
   * Sync forcée utilisateur : recharge la file disque, force tous les items,
   * ping HTTP du serveur, envoie via HTTP (prioritaire) jusqu’à épuisement.
   */
  async forceSync(): Promise<ClientConnectionStatus> {
    if (this.flushInFlight) {
      await this.flushInFlight
    }

    if (!this.connectOpts) {
      this.status.lastError =
        'Connexion client non initialisée — reconnectez-vous au serveur'
      this.status.connected = false
      return this.getStatus()
    }

    const q = this.ensureQueue()
    q.reload()
    q.markAllForce()
    this.status.queueSize = q.size()

    if (q.size() === 0) {
      this.status.lastFlushSent = 0
      this.status.lastFlushFailed = 0
      this.status.lastError = null
      const reachable = await this.pingServer(
        this.connectOpts.serverHost,
        this.connectOpts.serverPort || DEFAULT_SERVER_PORT
      )
      this.status.connected = reachable
      return this.getStatus()
    }

    this.flushInFlight = this.doFlush(true)
    try {
      await this.flushInFlight
      if (q.size() > 0) {
        q.reload()
        q.markAllForce()
        await this.doFlush(true)
      }
    } finally {
      this.flushInFlight = null
    }
    return this.getStatus()
  }

  /** Nombre d’enregistrements visibles côté client (file locale + serveur). */
  async countRegistered(): Promise<number> {
    const q = this.ensureQueue()
    q.reload()
    this.status.queueSize = q.size()

    const pendingIds = new Set<string>()
    for (const item of q.list()) {
      if (item.operation !== 'upsert' || !item.payload || typeof item.payload !== 'object') continue
      const id = (item.payload as { id?: string }).id
      if (id) pendingIds.add(id)
    }

    if (this.connectOpts) {
      try {
        const port = this.connectOpts.serverPort || DEFAULT_SERVER_PORT
        const params = new URLSearchParams({
          q: '',
          createdBy: this.connectOpts.username.trim(),
          limit: '50000',
          offset: '0'
        })
        const url = `http://${this.connectOpts.serverHost}:${port}/api/judokas/search?${params}`
        const res = await fetch(url)
        if (res.ok) {
          const data = (await res.json()) as { items?: Array<{ id?: string }> }
          for (const j of data.items ?? []) {
            if (j.id) pendingIds.add(j.id)
          }
        }
      } catch {
        /* hors ligne : on compte au moins la file locale */
      }
    }

    return pendingIds.size
  }

  private async doFlush(forceReconnect: boolean): Promise<void> {
    const q = this.ensureQueue()
    if (!this.connectOpts) {
      this.status.lastError = 'Configuration client manquante'
      this.status.queueSize = q.size()
      this.status.lastFlushSent = 0
      this.status.lastFlushFailed = 0
      return
    }

    const httpTarget = {
      host: this.connectOpts.serverHost,
      port: this.connectOpts.serverPort || DEFAULT_SERVER_PORT
    }

    // Vérifie que le serveur HTTP répond (même réseau LAN)
    const reachable = await this.pingServer(httpTarget.host, httpTarget.port)
    if (!reachable) {
      if (forceReconnect) {
        await this.tryConnect()
      }
      const stillDown = !(await this.pingServer(httpTarget.host, httpTarget.port))
      if (stillDown) {
        this.status.connected = false
        this.status.lastError =
          this.status.lastError ??
          `Serveur injoignable sur ${httpTarget.host}:${httpTarget.port}`
        this.status.queueSize = q.size()
        this.status.lastFlushSent = 0
        this.status.lastFlushFailed = 0
        return
      }
    }

    // Tente aussi la socket (optionnel) puis sync HTTP prioritaire
    if (forceReconnect) {
      await this.tryConnect()
    }
    const socket = await this.getLiveSocket()
    const result = await flushSyncQueue(q, socket, httpTarget)

    this.status.connected = reachable || Boolean(socket?.connected) || result.sent > 0
    this.status.queueSize = result.remaining
    this.status.lastFlushSent = result.sent
    this.status.lastFlushFailed = result.failed

    if (result.sent > 0) {
      this.status.lastSyncAt = new Date().toISOString()
    }
    if (result.remaining === 0) {
      this.status.lastError = null
    } else if (result.lastError) {
      this.status.lastError = result.lastError
    }
  }

  private async pingServer(host: string, port: number): Promise<boolean> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8_000)
    try {
      const res = await fetch(`http://${host}:${port}/api/info`, {
        method: 'GET',
        signal: ctrl.signal
      })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /** Toujours le même module que connectToServer (évite le double singleton require/import). */
  private async getLiveSocket(): Promise<{ connected: boolean } | null> {
    const { getSocket } = await import('@server/client/socket-client')
    return getSocket()
  }

  private async tryConnect(): Promise<boolean> {
    if (!this.connectOpts) return false

    const existing = await this.getLiveSocket()
    if (existing?.connected) {
      this.status.connected = true
      this.status.lastError = null
      return true
    }

    const { connectToServer } = await import('@server/client/socket-client')
    try {
      await connectToServer({
        host: this.connectOpts.serverHost,
        port: this.connectOpts.serverPort || DEFAULT_SERVER_PORT,
        username: this.connectOpts.username,
        workstation: this.connectOpts.workstation,
        onStatus: (s) => {
          this.status = {
            ...this.status,
            ...s,
            queueSize: this.queue?.size() ?? 0
          }
          if (s.connected) void this.flush(false)
        }
      })
      this.status.connected = true
      this.status.lastError = null
      return true
    } catch (err) {
      this.status.connected = false
      this.status.lastError =
        err instanceof Error ? err.message : 'Connexion serveur impossible'
      return false
    }
  }

  listQueue(): QueueItem[] {
    return this.ensureQueue().list()
  }

  /**
   * Vide le stockage local des judokas en attente sur cet ordinateur
   * (tous utilisateurs confondus) — plus rien à synchroniser.
   */
  clearLocalPending(): { cleared: number; queueSize: number } {
    const q = this.ensureQueue()
    q.reload()
    const cleared = q.clearAll()
    this.status.queueSize = 0
    this.status.lastError = null
    this.status.lastFlushSent = 0
    this.status.lastFlushFailed = 0
    return { cleared, queueSize: 0 }
  }

  private startAutoFlush(): void {
    this.stopAutoFlush()
    // Toutes les 5 s : envoi HTTP/socket sans reconnecter à chaque tick
    this.flushTimer = setInterval(() => {
      void this.flush(false)
    }, 5_000)
  }

  private stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  getStatus(): ClientConnectionStatus {
    const q = this.ensureQueue()
    return {
      ...this.status,
      queueSize: q.size(),
      connected: this.status.connected
    }
  }

  /** Met à jour le flag connected depuis la socket live. */
  async refreshConnected(): Promise<void> {
    const socket = await this.getLiveSocket()
    this.status.connected = Boolean(socket?.connected)
  }

  getDashboardStats(): DashboardStats {
    const connected = this.getStatus().connected
    const q = this.ensureQueue()
    q.reload()
    return {
      totalJudokas: 0,
      connectedClients: 0,
      networkStatus: connected ? 'online' : 'offline',
      pendingSyncCount: q.size(),
      lastSyncAt: this.status.lastSyncAt,
      recentLogs: [],
      userActivity: [],
      judokaByUser: []
    }
  }
}

function enrichPayloadWithPhoto(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const data = { ...(payload as Record<string, unknown>) }
  const photoPath = typeof data.photoPath === 'string' ? data.photoPath : null
  if (!photoPath || !existsSync(photoPath) || typeof data.photoBase64 === 'string') {
    return data
  }
  try {
    const buf = readFileSync(photoPath)
    data.photoBase64 = buf.toString('base64')
    data.photoExt = extname(photoPath).toLowerCase() || '.jpg'
  } catch {
    /* conserve le chemin local */
  }
  return data
}

const singleton = new ClientRuntime()

export function getClientRuntime(): ClientRuntime {
  return singleton
}

export async function connectClientRuntime(opts: ClientConnectOptions): Promise<void> {
  await singleton.connect(opts)
}

export async function disconnectClientRuntime(): Promise<void> {
  await singleton.disconnect()
}
