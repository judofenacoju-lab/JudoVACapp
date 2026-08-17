/**
 * Format propriétaire .jvac — identique Online (web) et Offline (Electron).
 *
 * Fichier = header texte + payload gzip :
 *   JVAC1|<version>|<sha256>|
 *   <gzip(JSON bundle)>
 */

export const JVAC_MAGIC = 'JVAC1'
export const JVAC_FORMAT_VERSION = 1

export interface JvacManifest {
  magic: typeof JVAC_MAGIC
  formatVersion: number
  createdAt: string
  appVersion: string
  checksumSha256: string
  counts: {
    judokas: number
    photos: number
    logs: number
  }
}

export interface JvacFileEntry {
  relativePath: string
  encoding: 'base64'
  data: string
}

export interface JvacTables {
  judokas: unknown[]
  system_logs: unknown[]
  settings: unknown[]
  badge_templates: unknown[]
  user_accounts?: unknown[]
}

export interface JvacBundleDraft {
  manifest: Omit<JvacManifest, 'checksumSha256'>
  tables: JvacTables
  files: JvacFileEntry[]
}

export type JvacBundle = JvacBundleDraft & { manifest: JvacManifest }

export function createJvacDraft(opts: {
  tables: JvacTables
  files: JvacFileEntry[]
  appVersion: string
  createdAt?: string
}): JvacBundleDraft {
  return {
    manifest: {
      magic: JVAC_MAGIC,
      formatVersion: JVAC_FORMAT_VERSION,
      createdAt: opts.createdAt ?? new Date().toISOString(),
      appVersion: opts.appVersion,
      counts: {
        judokas: opts.tables.judokas.length,
        photos: opts.files.filter((f) => f.relativePath.startsWith('photos/')).length,
        logs: opts.tables.system_logs.length
      }
    },
    tables: opts.tables,
    files: opts.files
  }
}

export function jvacChecksumInput(draft: JvacBundleDraft): string {
  return JSON.stringify(draft)
}

export function attachJvacChecksum(draft: JvacBundleDraft, checksumSha256: string): JvacBundle {
  return {
    ...draft,
    manifest: { ...draft.manifest, checksumSha256 }
  }
}

export function packJvacBytes(checksumSha256: string, gzippedJson: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(
    `${JVAC_MAGIC}|${JVAC_FORMAT_VERSION}|${checksumSha256}|\n`
  )
  const out = new Uint8Array(header.length + gzippedJson.length)
  out.set(header, 0)
  out.set(gzippedJson, header.length)
  return out
}

export function isJvacBytes(raw: Uint8Array): boolean {
  if (raw.length < 6) return false
  return new TextDecoder().decode(raw.subarray(0, 6)) === `${JVAC_MAGIC}|`
}

export function unpackJvacBytes(raw: Uint8Array): {
  magic: string
  version: number
  checksum: string
  gzipped: Uint8Array
} {
  const nl = raw.indexOf(0x0a)
  if (nl < 0) throw new Error('Fichier .jvac invalide (header manquant)')
  const header = new TextDecoder().decode(raw.subarray(0, nl))
  const [magic, ver, checksum] = header.split('|')
  if (magic !== JVAC_MAGIC) throw new Error('Magic .jvac incorrect')
  if (Number(ver) !== JVAC_FORMAT_VERSION) {
    throw new Error(`Version format non supportée: ${ver}`)
  }
  if (!checksum) throw new Error('Fichier .jvac invalide (checksum manquant)')
  return {
    magic,
    version: Number(ver),
    checksum,
    gzipped: raw.subarray(nl + 1)
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, '0')
  }
  return s
}

export function photoBasename(path: string | null | undefined): string | null {
  if (!path) return null
  const base = path.replace(/\\/g, '/').split('/').pop()?.trim()
  return base || null
}

export function extractSettingsValue(tables: JvacTables | undefined): unknown {
  const row = tables?.settings?.[0] as { value?: unknown } | undefined
  return row?.value ?? null
}

export function extractJudokas(tables: JvacTables | undefined): unknown[] {
  return Array.isArray(tables?.judokas) ? tables.judokas : []
}
