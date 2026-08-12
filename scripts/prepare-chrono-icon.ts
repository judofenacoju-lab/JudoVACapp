/**
 * Prépare l’icône JVac-Chrono (PNG circulaire transparent + ICO + ICNS).
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'chrono-app', 'build')
const source =
  process.argv[2] ||
  join(
    process.env.HOME ?? '',
    '.cursor/projects/Users-macbook-Desktop-Apps-JudoVACapp-Online/assets/Icon-JVAC-Chrono-06ba2cc0-734e-456c-81b0-cfa11b731094.png'
  )

if (!existsSync(source)) {
  console.error('Logo source introuvable:', source)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

const raw = PNG.sync.read(readFileSync(source))
const size = Math.min(raw.width, raw.height)
const cx = (raw.width - 1) / 2
const cy = (raw.height - 1) / 2
const radius = size / 2 - 0.5

for (let y = 0; y < raw.height; y++) {
  for (let x = 0; x < raw.width; x++) {
    const i = (raw.width * y + x) << 2
    const dx = x - cx
    const dy = y - cy
    const dist = Math.hypot(dx, dy)
    const r = raw.data[i]!
    const g = raw.data[i + 1]!
    const b = raw.data[i + 2]!
    const outside = dist > radius
    const nearBlack = r < 28 && g < 28 && b < 28
    if (outside || nearBlack) raw.data[i + 3] = 0
  }
}

const png1024 = scalePng(raw, 1024)
const png512 = scalePng(raw, 512)
writeFileSync(join(outDir, 'icon.png'), PNG.sync.write(png1024))
copyFileSync(join(outDir, 'icon.png'), join(outDir, 'icon-source.png'))

const ico = await pngToIco([
  Buffer.from(PNG.sync.write(scalePng(raw, 16))),
  Buffer.from(PNG.sync.write(scalePng(raw, 32))),
  Buffer.from(PNG.sync.write(scalePng(raw, 48))),
  Buffer.from(PNG.sync.write(scalePng(raw, 64))),
  Buffer.from(PNG.sync.write(scalePng(raw, 128))),
  Buffer.from(PNG.sync.write(scalePng(raw, 256)))
])
writeFileSync(join(outDir, 'icon.ico'), ico)

const iconset = join(outDir, 'icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })
const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]
for (const [px, name] of sizes) {
  writeFileSync(join(iconset, name), PNG.sync.write(scalePng(raw, Number(px))))
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(outDir, 'icon.icns')])
rmSync(iconset, { recursive: true, force: true })

console.log('Icône JVac-Chrono prête:', outDir)
console.log('  icon.png / icon.ico / icon.icns')

function scalePng(src: PNG, target: number): PNG {
  const dst = new PNG({ width: target, height: target })
  for (let y = 0; y < target; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / target))
    for (let x = 0; x < target; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / target))
      const si = (src.width * sy + sx) << 2
      const di = (target * y + x) << 2
      dst.data[di] = src.data[si]!
      dst.data[di + 1] = src.data[si + 1]!
      dst.data[di + 2] = src.data[si + 2]!
      dst.data[di + 3] = src.data[si + 3]!
    }
  }
  return dst
}

void png512
