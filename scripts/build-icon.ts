/**
 * Génère build/icon.png (256) à partir de build/icon-source.png si présent,
 * sinon dessine une icône programmatique via un PNG minimal.
 *
 * Usage: npm run icon:build
 */
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { deflateSync } from 'zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const sourceCandidates = [
  join(buildDir, 'icon-source.png'),
  join(root, 'assets', 'icon-source.png'),
  join(root, 'icon-source.png')
]

if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true })

const source = sourceCandidates.find((p) => existsSync(p))

if (source) {
  const dest = join(buildDir, 'icon.png')
  const uiDest = join(root, 'src', 'assets', 'brand-logo.png')
  copyFileSync(source, dest)
  mkdirSync(join(root, 'src', 'assets'), { recursive: true })
  copyFileSync(source, uiDest)
  console.log(`Icône copiée: ${source} → ${dest}`)
  console.log(`Logo UI copié: ${uiDest}`)
  console.log('Assurez-vous que build/icon.ico est à jour pour le packaging Windows.')
  process.exit(0)
}

/** PNG 256×256 programmatique (navy + bande rouge + carré or) — sans dépendance. */
function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

function makePng(size: number): Buffer {
  const navy = [11, 31, 58]
  const red = [200, 16, 46]
  const gold = [201, 162, 39]
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4
      let r = navy[0]!, g = navy[1]!, b = navy[2]!
      // Bande ceinture
      if (y > size * 0.55 && y < size * 0.68) {
        r = red[0]!; g = red[1]!; b = red[2]!
      }
      // Marque or centrale
      const cx = size / 2
      const cy = size * 0.38
      const d = Math.hypot(x - cx, y - cy)
      if (d < size * 0.12) {
        r = gold[0]!; g = gold[1]!; b = gold[2]!
      }
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const dest = join(buildDir, 'icon.png')
writeFileSync(dest, makePng(256))
console.log(`Icône générée (programmatique): ${dest}`)
void readFileSync
