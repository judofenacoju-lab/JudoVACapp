import {
  DEFAULT_CLOUD_BASE_URL,
  DEFAULT_SERVER_PORT,
  type BadgeVerifyPayload,
  type ServerMode
} from './types'

export function buildBaseUrl(opts: {
  mode: ServerMode
  cloudUrl?: string
  host?: string
  port?: number
}): string {
  if (opts.mode === 'cloud') {
    const raw = (opts.cloudUrl || DEFAULT_CLOUD_BASE_URL).trim().replace(/\/$/, '')
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    return `https://${raw}`
  }
  const trimmed = (opts.host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  const port = opts.port ?? DEFAULT_SERVER_PORT
  return `http://${trimmed}:${port}`
}

export async function pingServer(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { method: 'GET' })
    if (!res.ok) {
      // Fallback LAN Electron
      const health = await fetch(`${baseUrl}/health`, { method: 'GET' })
      if (!health.ok) return false
      const data = (await health.json()) as { ok?: boolean }
      return data.ok === true
    }
    const data = (await res.json()) as { ok?: boolean }
    return data.ok === true
  } catch {
    return false
  }
}

export async function verifyBadge(
  baseUrl: string,
  qr: { id?: string; displayId?: string }
): Promise<{ ok: true; badge: BadgeVerifyPayload } | { ok: false; error: string }> {
  const params = new URLSearchParams()
  if (qr.id) params.set('id', qr.id)
  if (qr.displayId) params.set('displayId', qr.displayId)

  if (!qr.id && !qr.displayId) {
    return { ok: false, error: 'QR code invalide' }
  }

  try {
    const res = await fetch(`${baseUrl}/api/badges/verify?${params.toString()}`)
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      badge?: BadgeVerifyPayload
      error?: string
    }
    if (res.status === 404) {
      return { ok: false, error: data.error ?? 'Badge non reconnu' }
    }
    if (!res.ok || !data.ok || !data.badge) {
      return { ok: false, error: data.error ?? 'Erreur serveur' }
    }
    return { ok: true, badge: data.badge }
  } catch {
    return {
      ok: false,
      error: 'Impossible de joindre le serveur — vérifiez la connexion Internet'
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
