import type { Socket } from 'socket.io-client'
import { SocketEvents } from '@shared/constants/socket-events'
import type { SyncQueue, QueueItem } from './sync-queue'

export interface FlushResult {
  sent: number
  failed: number
  remaining: number
  lastError?: string
}

export interface HttpFlushTarget {
  host: string
  port: number
}

const SYNC_TIMEOUT_MS = 45_000

type SendResult = { ok: boolean; error?: string; code?: string; networkError?: boolean }

/**
 * Vide la file vers le serveur — HTTP d’abord (fiable sur LAN), Socket en secours.
 */
export async function flushSyncQueue(
  queue: SyncQueue,
  socket: Socket | null,
  httpTarget?: HttpFlushTarget | null
): Promise<FlushResult> {
  if (httpTarget?.host) {
    const httpResult = await flushViaHttp(queue, httpTarget)
    if (httpResult.remaining === 0 || httpResult.sent > 0) {
      return httpResult
    }
    // Si HTTP a tout échoué sans réseau, tenter socket
    if (!httpResult.networkError && socket?.connected) {
      const sockResult = await flushViaSocket(queue, socket)
      return {
        sent: httpResult.sent + sockResult.sent,
        failed: httpResult.failed + sockResult.failed,
        remaining: queue.size(),
        lastError: sockResult.lastError ?? httpResult.lastError
      }
    }
    return httpResult
  }

  return flushViaSocket(queue, socket)
}

async function flushViaHttp(queue: SyncQueue, target: HttpFlushTarget): Promise<FlushResult & { networkError?: boolean }> {
  const base = `http://${target.host}:${target.port}/api`
  let sent = 0
  let failed = 0
  let lastError: string | undefined
  let hitNetworkError = false
  const snapshot = queue.list()

  for (const item of snapshot) {
    let result = await sendItemHttp(base, item, item.force ?? true)
    if (!result.ok && (result.code === 'DUPLICATE' || /doublon/i.test(result.error ?? ''))) {
      result = await sendItemHttp(base, item, true)
    }

    if (result.ok) {
      queue.remove(item.id)
      sent++
      continue
    }

    queue.markAttempt(item.id, result.error)
    failed++
    lastError = result.error
    if (result.networkError) {
      hitNetworkError = true
      break
    }
  }

  return {
    sent,
    failed,
    remaining: queue.size(),
    lastError,
    networkError: hitNetworkError
  }
}

async function sendItemHttp(
  baseUrl: string,
  item: QueueItem,
  force: boolean
): Promise<SendResult> {
  try {
    if (item.operation === 'upsert') {
      const res = await fetch(`${baseUrl}/judokas/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: item.payload, force, clientQueueId: item.id })
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        code?: string
      }
      if (res.ok && body.ok !== false) {
        return { ok: true }
      }
      return {
        ok: false,
        error: body.error ?? `HTTP ${res.status}`,
        code: body.code,
        networkError: res.status >= 500
      }
    }

    if (item.operation === 'delete') {
      const id =
        typeof item.payload === 'object' && item.payload && 'id' in item.payload
          ? String((item.payload as { id: string }).id)
          : String(item.payload)
      const actor =
        typeof item.payload === 'object' && item.payload && 'actor' in item.payload
          ? String((item.payload as { actor?: string }).actor ?? '')
          : ''
      const res = await fetch(`${baseUrl}/judokas/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor })
      })
      if (res.ok || res.status === 204 || res.status === 404) {
        return { ok: true }
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      return {
        ok: false,
        error: body.error ?? `HTTP ${res.status}`,
        code: body.code,
        networkError: res.status >= 500
      }
    }

    return { ok: false, error: 'Opération inconnue' }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      networkError: true
    }
  }
}

async function flushViaSocket(queue: SyncQueue, socket: Socket | null): Promise<FlushResult> {
  if (!socket?.connected) {
    return { sent: 0, failed: 0, remaining: queue.size(), lastError: 'Socket déconnecté' }
  }

  let sent = 0
  let failed = 0
  let lastError: string | undefined
  const snapshot = queue.list()

  for (const item of snapshot) {
    if (!socket.connected) {
      lastError = 'Socket déconnecté'
      break
    }

    let result = await sendItemSocket(socket, item, item.force ?? false)
    if (!result.ok && (result.code === 'DUPLICATE' || /doublon/i.test(result.error ?? ''))) {
      result = await sendItemSocket(socket, item, true)
    }

    if (result.ok) {
      queue.remove(item.id)
      sent++
      continue
    }

    queue.markAttempt(item.id, result.error)
    failed++
    lastError = result.error
    if (result.networkError) break
  }

  return { sent, failed, remaining: queue.size(), lastError }
}

function sendItemSocket(
  socket: Socket,
  item: QueueItem,
  force: boolean
): Promise<SendResult> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Socket déconnecté', networkError: true })
      return
    }

    let settled = false
    const finish = (result: SendResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off(SocketEvents.JUDOKA_UPSERT_ACK, onAckEvent)
      socket.off(SocketEvents.JUDOKA_UPSERT_NACK, onNackEvent)
      socket.off(SocketEvents.JUDOKA_DELETE_ACK, onDeleteAck)
      socket.off(SocketEvents.JUDOKA_DELETE_NACK, onDeleteNack)
      resolve(result)
    }

    const timer = setTimeout(
      () => finish({ ok: false, error: 'Timeout sync (réseau lent)', networkError: true }),
      SYNC_TIMEOUT_MS
    )

    const handleAck = (ack: { ok?: boolean; error?: string; code?: string; clientQueueId?: string } | undefined) => {
      finish({
        ok: Boolean(ack?.ok),
        error: ack?.ok ? undefined : ack?.error ?? 'NACK serveur',
        code: ack?.code,
        networkError: false
      })
    }

    const onAckEvent = (ack: { ok?: boolean; clientQueueId?: string; error?: string; code?: string }) => {
      if (ack?.clientQueueId && ack.clientQueueId !== item.id) return
      handleAck(ack)
    }
    const onNackEvent = (ack: { ok?: boolean; clientQueueId?: string; error?: string; code?: string }) => {
      if (ack?.clientQueueId && ack.clientQueueId !== item.id) return
      handleAck({ ...ack, ok: false })
    }
    const onDeleteAck = (ack: { ok?: boolean; id?: string }) => {
      handleAck({ ok: Boolean(ack?.ok) })
    }
    const onDeleteNack = (ack: { ok?: boolean; error?: string; code?: string }) => {
      handleAck({ ...ack, ok: false })
    }

    if (item.operation === 'upsert') {
      socket.on(SocketEvents.JUDOKA_UPSERT_ACK, onAckEvent)
      socket.on(SocketEvents.JUDOKA_UPSERT_NACK, onNackEvent)
      socket.emit(
        SocketEvents.JUDOKA_UPSERT,
        { data: item.payload, force, clientQueueId: item.id },
        handleAck
      )
      return
    }

    if (item.operation === 'delete') {
      const id =
        typeof item.payload === 'object' && item.payload && 'id' in item.payload
          ? String((item.payload as { id: string }).id)
          : String(item.payload)
      socket.on(SocketEvents.JUDOKA_DELETE_ACK, onDeleteAck)
      socket.on(SocketEvents.JUDOKA_DELETE_NACK, onDeleteNack)
      socket.emit(
        SocketEvents.JUDOKA_DELETE,
        { id, actor: (item.payload as { actor?: string })?.actor },
        handleAck
      )
      return
    }

    finish({ ok: false, error: 'Opération inconnue' })
  })
}
