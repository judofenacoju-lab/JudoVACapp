import { DEFAULT_SERVER_PORT } from '@shared/constants/app'

const IPV4_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g

/** IPv4 privée (LAN), hors loopback / link-local. */
export function isLanIpv4(ip: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false
  if (ip.startsWith('127.') || ip.startsWith('0.') || ip.startsWith('169.254.')) return false
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true
  const m = /^172\.(\d+)\./.exec(ip)
  if (!m) return false
  const n = Number(m[1])
  return n >= 16 && n <= 31
}

function scoreLan(ip: string): number {
  if (ip.startsWith('192.168.')) return 30
  if (ip.startsWith('10.')) return 20
  return 10
}

function collectFromText(text: string, into: Set<string>): void {
  const matches = text.match(IPV4_RE) ?? []
  for (const ip of matches) {
    if (isLanIpv4(ip)) into.add(ip)
  }
}

function detectViaWebRtc(): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>()
    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      })
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
      collectFromText(ev.candidate.candidate ?? '', found)
      const addr = (ev.candidate as RTCIceCandidate & { address?: string }).address
      if (addr && isLanIpv4(addr)) found.add(addr)
    }

    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        collectFromText(pc.localDescription?.sdp ?? '', found)
      })
      .catch(() => done())

    window.setTimeout(done, 2500)
  })
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
    if (isLanIpv4(row.address)) found.add(row.address)
  }
  const preferred = fromStatus?.preferredAddress
  if (preferred && isLanIpv4(preferred)) found.add(preferred)

  for (const ip of await detectViaWebRtc()) found.add(ip)

  return [...found].sort((a, b) => scoreLan(b) - scoreLan(a))
}

export function chronoListenPort(fromStatus?: number | null): number {
  if (fromStatus && fromStatus !== 443 && fromStatus !== 80) return fromStatus
  return DEFAULT_SERVER_PORT
}
