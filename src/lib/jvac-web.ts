import {
  attachJvacChecksum,
  bytesToHex,
  isJvacBytes,
  jvacChecksumInput,
  packJvacBytes,
  unpackJvacBytes,
  type JvacBundle,
  type JvacBundleDraft
} from '@shared/utils/jvac-codec'

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return bytesToHex(new Uint8Array(buf))
}

async function gzipString(json: string): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('Compression gzip indisponible dans ce navigateur')
  }
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzipToString(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Décompression gzip indisponible dans ce navigateur')
  }
  const copy = new Uint8Array(bytes)
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

/** Encode un bundle au format binaire .jvac (identique à Electron Offline). */
export async function encodeJvacBundle(
  draft: JvacBundleDraft
): Promise<{ bytes: Uint8Array; bundle: JvacBundle }> {
  const checksumSha256 = await sha256Hex(jvacChecksumInput(draft))
  const bundle = attachJvacChecksum(draft, checksumSha256)
  const gzipped = await gzipString(JSON.stringify(bundle))
  return { bytes: packJvacBytes(checksumSha256, gzipped), bundle }
}

/** Décode un fichier .jvac (export Online ou Offline). */
export async function decodeJvacBundle(raw: Uint8Array): Promise<JvacBundle> {
  if (!isJvacBytes(raw)) throw new Error('Fichier .jvac invalide')
  const { checksum, gzipped } = unpackJvacBytes(raw)
  const json = await gunzipToString(gzipped)
  const bundle = JSON.parse(json) as JvacBundle
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
  const recalc = await sha256Hex(jvacChecksumInput(draft))
  if (recalc !== checksum) {
    throw new Error('Intégrité .jvac échouée (SHA-256)')
  }
  return bundle
}
