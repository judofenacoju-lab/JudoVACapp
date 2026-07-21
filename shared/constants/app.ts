export const APP_NAME = 'JudoVACapp'
export const APP_VERSION = '1.0.0'

/** Port HTTP + Socket.IO du serveur LAN. */
export const DEFAULT_SERVER_PORT = 3847

/** Taille max file d'attente client avant alerte UX. */
export const SYNC_QUEUE_WARN_THRESHOLD = 100

/** Intervalle heartbeat client → serveur (ms). */
export const HEARTBEAT_INTERVAL_MS = 5_000

/** Timeout reconnexion Socket.IO. */
export const RECONNECT_DELAY_MS = 2_000
