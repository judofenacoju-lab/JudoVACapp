import os from 'node:os'

export interface LocalNetworkAddress {
  address: string
  iface: string
}

/**
 * Adresses IPv4 LAN non loopback, utiles pour la connexion des clients.
 */
export function listLocalIpv4Addresses(): LocalNetworkAddress[] {
  const nets = os.networkInterfaces()
  const out: LocalNetworkAddress[] = []

  for (const [iface, entries] of Object.entries(nets)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' && (entry.family as unknown) !== 4) continue
      if (entry.internal) continue
      out.push({ address: entry.address, iface })
    }
  }

  return out.sort((a, b) => scoreAddress(b.address) - scoreAddress(a.address))
}

/** Préfère les plages privées classiques (192.168 → 10 → 172.16–31). */
export function getPreferredLanAddress(
  addresses: LocalNetworkAddress[] = listLocalIpv4Addresses()
): string | null {
  return addresses[0]?.address ?? null
}

function scoreAddress(address: string): number {
  if (address.startsWith('192.168.')) return 30
  if (address.startsWith('10.')) return 20
  const m = /^172\.(\d+)\./.exec(address)
  if (m) {
    const n = Number(m[1])
    if (n >= 16 && n <= 31) return 10
  }
  return 0
}
