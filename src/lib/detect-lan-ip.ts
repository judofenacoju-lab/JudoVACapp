import { DEFAULT_SERVER_PORT } from '@shared/constants/app'

const IPV4_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g

/** IPv4 utilisable (hors loopback / link-local). */
export function isUsableIpv4(ip: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false
  if (ip.startsWith('127.') || ip.startsWith('0.') || ip.startsWith('169.254.')) return false
  return true
}

/** IPv4 privée (LAN). */
export function isLanIpv4(ip: string): boolean {
  if (!isUsableIpv4(ip)) return false
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true
  const m = /^172\.(\d+)\./.exec(ip)
  if (!m) return false
  const n = Number(m[1])
  return n >= 16 && n <= 31
}

function scoreLan(ip: string): number {
  if (ip.startsWith('192.168.')) return 30
  if (ip.startsWith('10.')) return 20
  if (isLanIpv4(ip)) return 10
  return 1
}

function collectFromText(text: string, into: Set<string>, lanOnly: boolean): void {
  const matches = text.match(IPV4_RE) ?? []
  for (const ip of matches) {
    if (lanOnly ? isLanIpv4(ip) : isUsableIpv4(ip)) into.add(ip)
  }
}

function detectViaWebRtc(): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>()
    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({ iceServers: [] })
    } catch {
      resolve([])
      return
    }

    const done = (): void => {
      try {
        pc.close()
      } catch {
        /* ignore */
      }
      resolve([...found].sort((a, b) => scoreLan(b) - scoreLan(a)))
    }

    try {
      pc.createDataChannel('jvac-lan')
    } catch {
      /* ignore */
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        done()
        return
      }
      collectFromText(ev.candidate.candidate ?? '', found, true)
      const addr = (ev.candidate as RTCIceCandidate & { address?: string }).address
      if (addr && isLanIpv4(addr)) found.add(addr)
    }

    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        collectFromText(pc.localDescription?.sdp ?? '', found, true)
      })
      .catch(() => done())

    window.setTimeout(done, 1800)
  })
}

export interface LanNetworkInfo {
  addresses: Array<{ address: string; iface: string }>
  preferredAddress: string | null
  port: number
}

/**
 * Interroge le serveur LAN local (127.0.0.1) — IPs lues via os.networkInterfaces().
 */
export async function fetchLanFromLocalServer(
  port = DEFAULT_SERVER_PORT
): Promise<LanNetworkInfo | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 900)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/network/lan`, {
      signal: ctrl.signal
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      ok?: boolean
      port?: number
      addresses?: Array<{ address: string; iface: string }>
      preferredAddress?: string | null
    }
    const addresses = (json.addresses ?? []).filter((row) => isUsableIpv4(row.address))
    if (addresses.length === 0) return null
    const listenPort =
      json.port && json.port !== 443 && json.port !== 80 ? json.port : port
    return {
      addresses,
      preferredAddress:
        json.preferredAddress && isUsableIpv4(json.preferredAddress)
          ? json.preferredAddress
          : (addresses[0]?.address ?? null),
      port: listenPort
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * IP LAN de cet ordinateur (pour JVac-Chrono), jamais l’hôte cloud (Vercel).
 */
export async function detectLanIpv4Addresses(fromStatus?: {
  localAddresses?: Array<{ address: string }>
  preferredAddress?: string | null
}): Promise<string[]> {
  const found = new Set<string>()

  for (const row of fromStatus?.localAddresses ?? []) {
    if (isUsableIpv4(row.address)) found.add(row.address)
  }
  const preferred = fromStatus?.preferredAddress
  if (preferred && isUsableIpv4(preferred)) found.add(preferred)

  if (found.size === 0) {
    const local = await fetchLanFromLocalServer()
    if (local) {
      for (const row of local.addresses) found.add(row.address)
      if (local.preferredAddress) found.add(local.preferredAddress)
    }
  }

  if (found.size === 0) {
    for (const ip of await detectViaWebRtc()) found.add(ip)
  }

  return [...found].sort((a, b) => scoreLan(b) - scoreLan(a))
}

export function chronoListenPort(fromStatus?: number | null): number {
  if (fromStatus && fromStatus !== 443 && fromStatus !== 80) return fromStatus
  return DEFAULT_SERVER_PORT
}
