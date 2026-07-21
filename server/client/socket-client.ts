import { io, type Socket } from 'socket.io-client'
import { SocketEvents } from '@shared/constants/socket-events'
import { HEARTBEAT_INTERVAL_MS, RECONNECT_DELAY_MS } from '@shared/constants/app'
import type { ClientConnectionStatus } from '@shared/types/dashboard'

export interface ConnectOptions {
  host: string
  port: number
  username: string
  workstation: string
  onStatus?: (partial: Partial<ClientConnectionStatus>) => void
}

let socket: Socket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

export async function connectToServer(opts: ConnectOptions): Promise<void> {
  await disconnectFromServer()

  const url = `http://${opts.host}:${opts.port}`
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: RECONNECT_DELAY_MS,
    reconnectionAttempts: Infinity,
    timeout: 12_000,
    forceNew: true
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Impossible de joindre le serveur ${url}`))
    }, 12_000)

    socket!.once('connect', () => {
      socket!.emit(SocketEvents.CLIENT_REGISTER, {
        username: opts.username,
        workstation: opts.workstation
      })
    })

    socket!.once(SocketEvents.CLIENT_REGISTERED, (res: { ok?: boolean; error?: string }) => {
      clearTimeout(timer)
      if (!res?.ok) {
        const msg = res?.error ?? 'Identifiant non autorisé par le serveur'
        opts.onStatus?.({ connected: false, lastError: msg })
        void disconnectFromServer()
        reject(new Error(msg))
        return
      }
      opts.onStatus?.({ connected: true, lastError: null })
      startHeartbeat()
      resolve()
    })

    socket!.once('connect_error', (err) => {
      clearTimeout(timer)
      opts.onStatus?.({ connected: false, lastError: err.message })
      reject(err)
    })
  })

  socket.on('disconnect', () => {
    opts.onStatus?.({ connected: false })
  })

  socket.on('reconnect', () => {
    socket?.emit(SocketEvents.CLIENT_REGISTER, {
      username: opts.username,
      workstation: opts.workstation
    })
  })

  socket.on(SocketEvents.CLIENT_REGISTERED, (res: { ok?: boolean; error?: string }) => {
    if (!res?.ok) {
      opts.onStatus?.({
        connected: false,
        lastError: res?.error ?? 'Identifiant refusé'
      })
      return
    }
    opts.onStatus?.({ connected: true, lastError: null })
  })
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    socket?.emit(SocketEvents.HEARTBEAT)
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export async function disconnectFromServer(): Promise<void> {
  stopHeartbeat()
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}

export function getSocket(): Socket | null {
  return socket
}
