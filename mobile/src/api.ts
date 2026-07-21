import { DEFAULT_SERVER_PORT } from './types'
import type { BadgeVerifyPayload } from './types'

export function buildServerBaseUrl(host: string, port = DEFAULT_SERVER_PORT): string {
  const trimmed = host.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `http://${trimmed}:${port}`
}

export async function pingServer(host: string, port = DEFAULT_SERVER_PORT): Promise<boolean> {
  try {
    const res = await fetch(`${buildServerBaseUrl(host, port)}/health`, {
      method: 'GET'
    })
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean }
    return data.ok === true
  } catch {
    return false
  }
}

export async function verifyBadge(
  host: string,
  port: number,
  qr: { id?: string; displayId?: string }
): Promise<{ ok: true; badge: BadgeVerifyPayload } | { ok: false; error: string }> {
  const params = new URLSearchParams()
  if (qr.id) params.set('id', qr.id)
  if (qr.displayId) params.set('displayId', qr.displayId)

  if (!qr.id && !qr.displayId) {
    return { ok: false, error: 'QR code invalide' }
  }

  try {
    const res = await fetch(
      `${buildServerBaseUrl(host, port)}/api/badges/verify?${params.toString()}`
    )
    if (res.status === 404) {
      return { ok: false, error: 'Badge non reconnu sur ce serveur' }
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: err.error ?? 'Erreur serveur' }
    }
    const data = (await res.json()) as { ok: boolean; badge: BadgeVerifyPayload }
    if (!data.ok || !data.badge) {
      return { ok: false, error: 'Réponse serveur invalide' }
    }
    return { ok: true, badge: data.badge }
  } catch {
    return {
      ok: false,
      error: 'Impossible de joindre le serveur — vérifiez le réseau Wi‑Fi'
    }
  }
}

export function parseQrPayload(raw: string): { id?: string; displayId?: string } | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const id = typeof data.id === 'string' ? data.id : undefined
    const displayId = typeof data.displayId === 'string' ? data.displayId : undefined
    if (!id && !displayId) return null
    return { id, displayId }
  } catch {
    return null
  }
}
