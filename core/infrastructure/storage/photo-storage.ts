import { createHash, randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { extname, join, resolve } from 'path'
import { app } from 'electron'

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function defaultUserData(): string {
  try {
    return app.getPath('userData')
  } catch {
    return resolve(process.cwd(), '.judovac-data')
  }
}

/**
 * Stockage photos judoka — fichiers locaux dans userData/photos.
 */
export class PhotoStorage {
  private readonly dir: string

  constructor(basePath?: string) {
    this.dir = join(basePath ?? defaultUserData(), 'photos')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  /** Enregistre un buffer (webcam base64 décodé ou import fichier). */
  saveBuffer(buffer: Buffer, originalName = 'photo.jpg'): string {
    const ext = normalizeExt(originalName)
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12)
    const filename = `${randomUUID()}-${hash}${ext}`
    const full = join(this.dir, filename)
    writeFileSync(full, buffer)
    return full
  }

  /** Copie un fichier image existant vers le dépôt photos. */
  importFile(sourcePath: string): string {
    const ext = normalizeExt(sourcePath)
    if (!ALLOWED.has(ext)) {
      throw new Error('Format image non supporté (JPG/PNG uniquement)')
    }
    const filename = `${randomUUID()}${ext}`
    const dest = join(this.dir, filename)
    copyFileSync(sourcePath, dest)
    return dest
  }

  getDir(): string {
    return this.dir
  }
}

function normalizeExt(name: string): string {
  const ext = extname(name).toLowerCase()
  if (ext === '.jpeg') return '.jpg'
  return ALLOWED.has(ext) ? ext : '.jpg'
}

/** Décode data URL webcam (data:image/jpeg;base64,...) */
export function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/[\w+.-]+;base64,(.+)$/i.exec(dataUrl)
  if (!match?.[1]) throw new Error('Data URL image invalide')
  return Buffer.from(match[1], 'base64')
}
