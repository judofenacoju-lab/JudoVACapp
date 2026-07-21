import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'fs'
import { join, dirname } from 'path'
import { gzipSync, gunzipSync } from 'zlib'

/**
 * Format propriétaire .jvac (stockage local JSON).
 *
 * Fichier = header texte + payload gzip :
 *   JVAC1|<version>|<sha256>|
 *   <gzip(JSON bundle)>
 */

const MAGIC = 'JVAC1'
const FORMAT_VERSION = 1

export interface JvacManifest {
  magic: typeof MAGIC
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

interface JvacBundleDraft {
  manifest: Omit<JvacManifest, 'checksumSha256'>
  tables: {
    judokas: unknown[]
    system_logs: unknown[]
    settings: unknown[]
    badge_templates: unknown[]
    user_accounts?: unknown[]
  }
  files: Array<{ relativePath: string; encoding: 'base64'; data: string }>
}

export type JvacBundle = JvacBundleDraft & { manifest: JvacManifest }

export interface ExportJvacFromTablesOptions {
  outputPath: string
  tables: JvacBundleDraft['tables']
  photosDir: string
  assetsDir: string
  appVersion: string
}

/** Export .jvac depuis les tables JSON locales. */
export async function exportJvacFromTables(
  opts: ExportJvacFromTablesOptions
): Promise<JvacManifest> {
  const files: JvacBundleDraft['files'] = []
  collectDirFiles(opts.photosDir, 'photos', files)
  collectDirFiles(opts.assetsDir, 'assets', files)

  const draft: JvacBundleDraft = {
    manifest: {
      magic: MAGIC,
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      appVersion: opts.appVersion,
      counts: {
        judokas: opts.tables.judokas.length,
        photos: files.filter((f) => f.relativePath.startsWith('photos/')).length,
        logs: opts.tables.system_logs.length
      }
    },
    tables: opts.tables,
    files
  }

  const checksumSha256 = createHash('sha256').update(JSON.stringify(draft)).digest('hex')
  const bundle: JvacBundle = {
    ...draft,
    manifest: { ...draft.manifest, checksumSha256 }
  }

  const gzipped = gzipSync(Buffer.from(JSON.stringify(bundle), 'utf-8'), { level: 9 })
  const header = Buffer.from(`${MAGIC}|${FORMAT_VERSION}|${checksumSha256}|\n`, 'utf-8')
  writeFileSync(opts.outputPath, Buffer.concat([header, gzipped]))

  return bundle.manifest
}

export function readJvacBundle(inputPath: string): JvacBundle {
  const raw = readFileSync(inputPath)
  const nl = raw.indexOf(0x0a)
  if (nl < 0) throw new Error('Fichier .jvac invalide (header manquant)')

  const header = raw.subarray(0, nl).toString('utf-8')
  const [magic, ver, expectedChecksum] = header.split('|')
  if (magic !== MAGIC) throw new Error('Magic .jvac incorrect')
  if (Number(ver) !== FORMAT_VERSION) throw new Error(`Version format non supportée: ${ver}`)

  const jsonBuf = gunzipSync(raw.subarray(nl + 1))
  const bundle = JSON.parse(jsonBuf.toString('utf-8')) as JvacBundle

  if (bundle.manifest.checksumSha256 !== expectedChecksum) {
    throw new Error('Checksum header ≠ manifeste — fichier corrompu')
  }

  const draft: JvacBundleDraft = {
    manifest: {
      magic: bundle.manifest.magic,
      formatVersion: bundle.manifest.formatVersion,
      createdAt: bundle.manifest.createdAt,
      appVersion: bundle.manifest.appVersion,
      counts: bundle.manifest.counts
    },
    tables: bundle.tables,
    files: bundle.files
  }
  const recalc = createHash('sha256').update(JSON.stringify(draft)).digest('hex')
  if (recalc !== expectedChecksum) {
    throw new Error('Intégrité .jvac échouée (SHA-256)')
  }

  return bundle
}

/** Restaure photos/assets d'un bundle .jvac. */
export function restoreJvacFiles(
  bundle: JvacBundle,
  photosDir: string,
  assetsDir: string
): void {
  if (!existsSync(photosDir)) mkdirSync(photosDir, { recursive: true })
  if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true })
  for (const file of bundle.files) {
    const full = file.relativePath.startsWith('photos/')
      ? join(photosDir, file.relativePath.slice('photos/'.length))
      : join(assetsDir, file.relativePath.slice('assets/'.length))
    const parent = dirname(full)
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
    writeFileSync(full, Buffer.from(file.data, 'base64'))
  }
}

function collectDirFiles(
  dir: string,
  prefix: string,
  out: JvacBundleDraft['files']
): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!statSync(full).isFile()) continue
    out.push({
      relativePath: `${prefix}/${name}`,
      encoding: 'base64',
      data: readFileSync(full).toString('base64')
    })
  }
}
