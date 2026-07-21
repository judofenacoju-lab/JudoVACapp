export interface ConnectedClient {
  socketId: string
  username: string
  workstation: string
  connectedAt: string
  lastHeartbeatAt: string
  ip: string
}

export interface JudokaUserStat {
  username: string
  count: number
}

export interface DashboardStats {
  totalJudokas: number
  connectedClients: number
  networkStatus: 'online' | 'offline' | 'degraded'
  pendingSyncCount: number
  lastSyncAt: string | null
  recentLogs: SystemLogEntry[]
  userActivity: UserActivityEntry[]
  /** Nombre de judokas enregistrés par utilisateur (Serveur en premier). */
  judokaByUser: JudokaUserStat[]
}

export interface SystemLogEntry {
  id: string
  level: 'info' | 'warn' | 'error'
  action: string
  message: string
  actor?: string
  workstation?: string
  createdAt: string
}

export interface UserActivityEntry {
  username: string
  workstation: string
  action: string
  at: string
}

export interface LocalNetworkAddress {
  address: string
  iface: string
}

export interface ServerStatus {
  running: boolean
  host: string
  port: number
  startedAt: string | null
  connectedClients: ConnectedClient[]
  dbReady: boolean
  /** Toujours `json` — stockage local. */
  dbBackend?: 'json' | null
  /** Adresses IPv4 LAN détectées automatiquement (pour les clients). */
  localAddresses: LocalNetworkAddress[]
  preferredAddress: string | null
}

export interface ClientConnectionStatus {
  connected: boolean
  serverHost: string | null
  serverPort: number | null
  lastError: string | null
  queueSize: number
  lastSyncAt: string | null
  /** Résultat du dernier flush (forcer sync / auto). */
  lastFlushSent?: number
  lastFlushFailed?: number
}
