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
import {
  attachJvacChecksum,
  createJvacDraft,
  isJvacBytes,
  jvacChecksumInput,
  packJvacBytes,
  unpackJvacBytes,
  type JvacBundle,
  type JvacBundleDraft,
  type JvacFileEntry,
  type JvacManifest
} from '@shared/utils/jvac-codec'

export type { JvacBundle, JvacManifest }

export interface ExportJvacFromTablesOptions {
  outputPath: string
  tables: JvacBundleDraft['tables']
  photosDir: string
  assetsDir: string
  appVersion: string
}

/** Export .jvac depuis les tables JSON locales (Offline). */
export async function exportJvacFromTables(
  opts: ExportJvacFromTablesOptions
): Promise<JvacManifest> {
  const files: JvacFileEntry[] = []
  collectDirFiles(opts.photosDir, 'photos', files)
  collectDirFiles(opts.assetsDir, 'assets', files)

  const draft = createJvacDraft({
    tables: opts.tables,
    files,
    appVersion: opts.appVersion
  })

  const checksumSha256 = createHash('sha256').update(jvacChecksumInput(draft)).digest('hex')
  const bundle = attachJvacChecksum(draft, checksumSha256)
  const gzipped = gzipSync(Buffer.from(JSON.stringify(bundle), 'utf-8'), { level: 9 })
  const packed = packJvacBytes(checksumSha256, gzipped)
  writeFileSync(opts.outputPath, packed)

  return bundle.manifest
}

export function readJvacBundle(inputPath: string): JvacBundle {
  const raw = new Uint8Array(readFileSync(inputPath))
  if (!isJvacBytes(raw)) throw new Error('Fichier .jvac invalide')
  const { checksum, gzipped } = unpackJvacBytes(raw)
  const jsonBuf = gunzipSync(Buffer.from(gzipped))
  const bundle = JSON.parse(jsonBuf.toString('utf-8')) as JvacBundle

  if (bundle.manifest.checksumSha256 !== checksum) {
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
    files: bundle.files ?? []
  }
  const recalc = createHash('sha256').update(jvacChecksumInput(draft)).digest('hex')
  if (recalc !== checksum) {
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
  for (const file of bundle.files ?? []) {
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
  out: JvacFileEntry[]
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
