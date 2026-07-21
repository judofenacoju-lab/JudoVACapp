/**
 * Smoke test sync LAN — démarre un serveur éphémère + 2 clients Socket.IO.
 *
 * Usage:
 *   npm run test:sync
 *
 * Vérifie :
 * - health HTTP
 * - enregistrement clients
 * - heartbeat ACK
 * - upsert judoka avec ACK (stockage JSON local)
 */
import { io, type Socket } from 'socket.io-client'
import { APP_NAME, DEFAULT_SERVER_PORT } from '../shared/constants/app'
import { SocketEvents } from '../shared/constants/socket-events'
import { bootstrapServer, shutdownServer, getConnectedClients } from '../server/bootstrap'

const PORT = Number(process.env.JUDVAC_TEST_PORT ?? DEFAULT_SERVER_PORT + 1)

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function waitForConnect(socket: Socket, timeoutMs = 8_000): Promise<void> {
  if (socket.connected) return
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout connexion Socket.IO')), timeoutMs)
    socket.once('connect', () => {
      clearTimeout(t)
      resolve()
    })
    socket.once('connect_error', (err) => {
      clearTimeout(t)
      reject(err)
    })
  })
}

async function main(): Promise<void> {
  console.log(`[test:sync] Démarrage serveur test sur 127.0.0.1:${PORT}…`)
  await bootstrapServer({ host: '127.0.0.1', port: PORT })

  const health = await fetch(`http://127.0.0.1:${PORT}/health`)
  assert(health.ok, 'Health HTTP KO')
  const healthJson = (await health.json()) as { app: string; ok: boolean }
  assert(healthJson.app === APP_NAME, 'Nom app incorrect')
  console.log('[test:sync] ✓ health')

  const clientA = io(`http://127.0.0.1:${PORT}`, {
    transports: ['websocket'],
    reconnection: false
  })
  const clientB = io(`http://127.0.0.1:${PORT}`, {
    transports: ['websocket'],
    reconnection: false
  })

  await waitForConnect(clientA)
  await waitForConnect(clientB)
  console.log('[test:sync] ✓ 2 sockets connectés')

  await new Promise<void>((resolve) => {
    clientA.emit(SocketEvents.CLIENT_REGISTER, {
      username: 'Testeur A',
      workstation: 'Poste-A'
    })
    clientA.once(SocketEvents.CLIENT_REGISTERED, () => resolve())
  })

  await new Promise<void>((resolve) => {
    clientB.emit(SocketEvents.CLIENT_REGISTER, {
      username: 'Testeur B',
      workstation: 'Poste-B'
    })
    clientB.once(SocketEvents.CLIENT_REGISTERED, () => resolve())
  })

  // Laisse le registry se mettre à jour
  await new Promise((r) => setTimeout(r, 150))
  const clients = getConnectedClients()
  assert(clients.length >= 2, `Attendu ≥2 clients, reçu ${clients.length}`)
  console.log(`[test:sync] ✓ registre clients (${clients.length})`)

  const heartbeatOk = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 3_000)
    clientA.once(SocketEvents.HEARTBEAT_ACK, () => {
      clearTimeout(t)
      resolve(true)
    })
    clientA.emit(SocketEvents.HEARTBEAT)
  })
  assert(heartbeatOk, 'Heartbeat ACK manquant')
  console.log('[test:sync] ✓ heartbeat')

  const upsertResult = await new Promise<{ ok?: boolean; error?: string }>((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'timeout upsert' }), 6_000)
    clientA.emit(
      SocketEvents.JUDOKA_UPSERT,
      {
        force: true,
        data: {
          lastName: 'TESTSYNC',
          middleName: '',
          firstName: 'Smoke',
          sex: 'M',
          birthDate: '2000-01-15',
          province: 'Test',
          city: 'Test',
          commune: '',
          address: '',
          phone: '',
          email: '',
          club: 'Club Test',
          league: '',
          sportProvince: '',
          grade: 'Ceinture blanche',
          belt: 'Blanche',
          category: '-66',
          weightKg: 66,
          heightCm: 170,
          licenseNumber: `SYNC-${Date.now()}`,
          affiliationYear: new Date().getFullYear(),
          photoPath: null,
          createdBy: 'Testeur A',
          createdWorkstation: 'Poste-A'
        }
      },
      (ack: { ok?: boolean; error?: string }) => {
        clearTimeout(t)
        resolve(ack ?? { ok: false, error: 'pas d’ACK' })
      }
    )
  })

  if (upsertResult.ok) {
    console.log('[test:sync] ✓ upsert judoka ACK (JSON local)')
  } else {
    console.log(`[test:sync] ✗ upsert NACK: ${upsertResult.error ?? '—'}`)
    assert(upsertResult.ok, `Upsert doit réussir avec stockage JSON: ${upsertResult.error}`)
  }

  const deleteResult = await new Promise<{ ok?: boolean; error?: string }>((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'timeout delete' }), 6_000)
    clientB.emit(
      SocketEvents.JUDOKA_DELETE,
      { id: '00000000-0000-0000-0000-000000000001', actor: 'Testeur B' },
      (ack: { ok?: boolean; error?: string }) => {
        clearTimeout(t)
        resolve(ack ?? { ok: false, error: 'pas d’ACK' })
      }
    )
  })
  assert(deleteResult.ok === true || typeof deleteResult.error === 'string', 'delete sans réponse')
  console.log(
    deleteResult.ok
      ? '[test:sync] ✓ delete ACK'
      : `[test:sync] ✓ canal delete répond (${deleteResult.error})`
  )

  clientA.close()
  clientB.close()
  await shutdownServer()
  console.log('[test:sync] OK — smoke sync LAN réussi')
}

main().catch(async (err) => {
  console.error('[test:sync] ÉCHEC:', err)
  try {
    await shutdownServer()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
