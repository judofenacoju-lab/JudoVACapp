import type { ProfileRow } from './supabase'

const DURABLE_KEY = 'judovac-durable-session'

export type DurableSession = {
  accessToken: string
  refreshToken: string
  profile: ProfileRow
  savedAt: number
}

export function saveDurableSession(
  accessToken: string,
  refreshToken: string,
  profile: ProfileRow
): void {
  try {
    const payload: DurableSession = {
      accessToken,
      refreshToken,
      profile,
      savedAt: Date.now()
    }
    localStorage.setItem(DURABLE_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn('[auth] saveDurableSession:', e)
  }
}

export function readDurableSession(): DurableSession | null {
  try {
    const raw = localStorage.getItem(DURABLE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DurableSession
    if (!parsed?.accessToken || !parsed?.profile?.id) return null
    return parsed
  } catch {
    return null
  }
}

export function clearDurableSession(): void {
  try {
    localStorage.removeItem(DURABLE_KEY)
  } catch {
    /* ignore */
  }
}

/** true si le JWT est absent ou expiré (marge 90 s — Mac/Chrome refresh plus tardif). */
export function isAccessTokenExpired(token: string | null | undefined): boolean {
  if (!token) return true
  try {
    const part = token.split('.')[1]
    if (!part) return true
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { exp?: number }
    if (typeof payload.exp !== 'number') return true
    return payload.exp * 1000 <= Date.now() + 90_000
  } catch {
    return true
  }
}
