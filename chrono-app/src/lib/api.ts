import type { ChronoConnectResponse, ChronoErrorResponse } from '@shared/types/chrono'

export function parseHostPort(raw: string, fallbackPort: number): { host: string; port: number } {
  const trimmed = raw.trim().replace(/^https?:\/\//i, '')
  const [hostPart, portPart] = trimmed.split(':')
  const host = (hostPart ?? '').trim()
  const port = portPart ? Number(portPart) : fallbackPort
  return { host, port: Number.isFinite(port) && port > 0 ? port : fallbackPort }
}

export function chronoBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = (await res.json().catch(() => ({}))) as T & ChronoErrorResponse
  if (!res.ok || (json as ChronoErrorResponse).ok === false) {
    throw new Error((json as ChronoErrorResponse).error || `Erreur HTTP ${res.status}`)
  }
  return json
}

export function connectChrono(
  base: string,
  password: string
): Promise<ChronoConnectResponse> {
  return post(`${base}/api/chrono/connect`, { password })
}

export function refreshChrono(
  base: string,
  password: string
): Promise<ChronoConnectResponse> {
  return post(`${base}/api/chrono/combats`, { password })
}

export function setChronoStatus(
  base: string,
  password: string,
  combatId: string,
  status: 'ready' | 'in_progress' | 'completed'
): Promise<ChronoConnectResponse> {
  return post(`${base}/api/chrono/combat/status`, { password, combatId, status })
}

export function setChronoWinner(
  base: string,
  password: string,
  combatId: string,
  winnerId: string,
  winMethod?: string
): Promise<ChronoConnectResponse> {
  return post(`${base}/api/chrono/combat/winner`, { password, combatId, winnerId, winMethod })
}

export function setChronoSubstitute(
  base: string,
  password: string,
  combatId: string,
  slot: 'top' | 'bottom'
): Promise<ChronoConnectResponse> {
  return post(`${base}/api/chrono/combat/substitute`, { password, combatId, slot })
}
