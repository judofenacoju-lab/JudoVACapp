import express from 'express'
import cors from 'cors'
import http from 'http'
import { Server as SocketServer } from 'socket.io'
import { DEFAULT_SERVER_PORT, APP_NAME, APP_VERSION } from '@shared/constants/app'
import { SocketEvents } from '@shared/constants/socket-events'
import type { ConnectedClient } from '@shared/types/dashboard'
import { createApiRouter } from './routes'
import { getContainer, resetContainer } from './container'
import { clientRegistry } from './client-registry'
import { upsertSyncedJudoka } from './judoka-sync'

export interface BootstrapOptions {
  host?: string
  port?: number
}

interface RuntimeState {
  httpServer: http.Server | null
  io: SocketServer | null
}

const state: RuntimeState = {
  httpServer: null,
  io: null
}

/**
 * Démarre Express + Socket.IO sur le réseau local.
 * Stockage judokas : JSON local (userData/data/judokas.json).
 */
export async function bootstrapServer(opts: BootstrapOptions = {}): Promise<void> {
  // Redémarrage propre si une instance tourne déjà dans ce processus
  if (state.httpServer || state.io) {
    await shutdownServer()
  }

  const host = opts.host ?? process.env.JUDVAC_SERVER_HOST ?? '0.0.0.0'
  const port = opts.port ?? Number(process.env.JUDVAC_SERVER_PORT ?? DEFAULT_SERVER_PORT)

  const container = getContainer()
  await container.initDatabase()

  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '15mb' }))
  app.use('/api', createApiRouter())

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      app: APP_NAME,
      version: APP_VERSION,
      clients: clientRegistry.size(),
      dbReady: container.dbReady
    })
  })

  const httpServer = http.createServer(app)
  const io = new SocketServer(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 15e6
  })

  io.on(SocketEvents.CONNECTION, (socket) => {
    socket.emit(SocketEvents.SERVER_INFO, {
      app: APP_NAME,
      version: APP_VERSION,
      dbReady: container.dbReady,
      at: new Date().toISOString()
    })

    socket.on(
      SocketEvents.CLIENT_REGISTER,
      (payload: { username: string; workstation: string }) => {
        const username = String(payload?.username ?? '').trim()
        const workstation = String(payload?.workstation ?? '').trim()
        const account = container.userAccounts.findByUsername(username)

        if (!account || !account.active) {
          socket.emit(SocketEvents.CLIENT_REGISTERED, {
            ok: false,
            error:
              'Identifiant inconnu. Demandez au Serveur de créer votre compte utilisateur avant de vous connecter.'
          })
          return
        }

        // Utiliser le username canonique du compte (reclaim judokas)
        const client: ConnectedClient = {
          socketId: socket.id,
          username: account.username,
          workstation: workstation || 'poste',
          connectedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
          ip: socket.handshake.address
        }
        clientRegistry.set(socket.id, client)
        void container.logger.log(
          'info',
          'client.connect',
          `${account.username} @ ${client.workstation}`,
          { actor: account.username, workstation: client.workstation }
        )
        socket.emit(SocketEvents.CLIENT_REGISTERED, { ok: true, client })
        io.emit(SocketEvents.CLIENT_LIST, clientRegistry.list())
      }
    )

    socket.on(SocketEvents.HEARTBEAT, () => {
      const c = clientRegistry.get(socket.id)
      if (c) {
        c.lastHeartbeatAt = new Date().toISOString()
        clientRegistry.set(socket.id, c)
      }
      socket.emit(SocketEvents.HEARTBEAT_ACK, { at: new Date().toISOString() })
    })

    /** Upsert judoka depuis un client + ACK/NACK (create si absent, sinon update) */
    socket.on(SocketEvents.JUDOKA_UPSERT, async (payload, ack?) => {
      try {
        const force = Boolean(payload?.force)
        const raw =
          payload?.data && typeof payload.data === 'object'
            ? (payload.data as Record<string, unknown>)
            : {}
        const result = await upsertSyncedJudoka(raw, force)
        const response = { ok: true, ...result, clientQueueId: payload?.clientQueueId }
        socket.emit(SocketEvents.JUDOKA_UPSERT_ACK, response)
        socket.broadcast.emit(SocketEvents.JUDOKA_UPDATED, result.judoka)
        if (typeof ack === 'function') ack(response)
      } catch (err) {
        const nack = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string }).code,
          details: (err as { details?: unknown }).details,
          clientQueueId: payload?.clientQueueId
        }
        socket.emit(SocketEvents.JUDOKA_UPSERT_NACK, nack)
        if (typeof ack === 'function') ack(nack)
      }
    })

    socket.on(SocketEvents.JUDOKA_DELETE, async (payload, ack?) => {
      try {
        if (!container.deleteJudoka) {
          const nack = { ok: false, error: 'Stockage local indisponible' }
          socket.emit(SocketEvents.JUDOKA_DELETE_NACK, nack)
          if (typeof ack === 'function') ack(nack)
          return
        }
        const id = typeof payload?.id === 'string' ? payload.id : null
        if (!id) {
          const nack = { ok: false, error: 'Identifiant judoka manquant' }
          socket.emit(SocketEvents.JUDOKA_DELETE_NACK, nack)
          if (typeof ack === 'function') ack(nack)
          return
        }
        await container.deleteJudoka.execute(id, payload?.actor)
        const response = { ok: true, id }
        socket.emit(SocketEvents.JUDOKA_DELETE_ACK, response)
        socket.broadcast.emit(SocketEvents.JUDOKA_DELETED, { id })
        if (typeof ack === 'function') ack(response)
      } catch (err) {
        const nack = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string }).code
        }
        socket.emit(SocketEvents.JUDOKA_DELETE_NACK, nack)
        if (typeof ack === 'function') ack(nack)
      }
    })

    socket.on(SocketEvents.DISCONNECT, () => {
      const leaving = clientRegistry.get(socket.id)
      clientRegistry.delete(socket.id)
      if (leaving) {
        void container.logger.log(
          'info',
          'client.disconnect',
          `${leaving.username} @ ${leaving.workstation}`,
          { actor: leaving.username, workstation: leaving.workstation }
        )
      }
      io.emit(SocketEvents.CLIENT_LIST, clientRegistry.list())
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      httpServer.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      httpServer.off('error', onError)
      resolve()
    }
    httpServer.once('error', onError)
    httpServer.once('listening', onListening)
    httpServer.listen(port, host)
  })

  state.httpServer = httpServer
  state.io = io
  console.log(
    `[JudoVACapp] Serveur LAN sur ${host}:${port} (stockage=json local)`
  )
}

export async function shutdownServer(): Promise<void> {
  if (state.io) {
    await new Promise<void>((resolve) => state.io!.close(() => resolve()))
    state.io = null
  }
  if (state.httpServer) {
    await new Promise<void>((resolve) => {
      state.httpServer!.close((err) => {
        // Socket.IO close() peut déjà avoir arrêté le serveur HTTP
        if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          console.warn('[JudoVACapp] shutdown http:', err.message)
        }
        resolve()
      })
    })
    state.httpServer = null
  }
  clientRegistry.clear()
  await resetContainer()
}

export function getConnectedClients(): ConnectedClient[] {
  return clientRegistry.list()
}

export function getIo(): SocketServer | null {
  return state.io
}
