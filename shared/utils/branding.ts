import { APP_NAME } from '@shared/constants/app'

const BRAND_CHANGED = 'judovac-brand-changed'

let activeBrandName = APP_NAME
let activeBrandLogo: string | null = null

export function resolveBrandName(eventName?: string | null): string {
  const n = eventName?.trim() ?? ''
  return n || APP_NAME
}

export function resolveBrandLogo(logoDataUrl?: string | null): string | null {
  const n = logoDataUrl?.trim() ?? ''
  return n || null
}

export function setActiveBrand(eventName?: string | null, logoDataUrl?: string | null): void {
  activeBrandName = resolveBrandName(eventName)
  activeBrandLogo = resolveBrandLogo(logoDataUrl)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BRAND_CHANGED))
  }
}

export function getActiveBrandName(): string {
  return activeBrandName || APP_NAME
}

export function getActiveBrandLogo(): string | null {
  return activeBrandLogo
}

/** Remplace « JudoVACapp » par le nom d’événement enregistré (ou le laisse si vide). */
export function withBrand(text: string): string {
  return text.split(APP_NAME).join(getActiveBrandName())
}

export function subscribeBrandChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(BRAND_CHANGED, listener)
  return () => window.removeEventListener(BRAND_CHANGED, listener)
}
