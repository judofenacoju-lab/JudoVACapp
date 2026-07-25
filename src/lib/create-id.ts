/**
 * UUID v4 compatible navigateurs anciens (tablettes Android sans crypto.randomUUID).
 */
export function createId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* continue fallback */
    }
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `jv-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`
}

/** Polyfill global pour le code qui appelle encore crypto.randomUUID. */
export function installRandomUuidPolyfill(): void {
  try {
    const c = globalThis.crypto as Crypto & { randomUUID?: () => string }
    if (!c) return
    if (typeof c.randomUUID === 'function') return
    Object.defineProperty(c, 'randomUUID', {
      value: () => createId(),
      configurable: true,
      writable: true
    })
  } catch {
    /* ignore */
  }
}
