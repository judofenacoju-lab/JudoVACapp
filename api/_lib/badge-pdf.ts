/**
 * Génération PDF badges — autonome pour Vercel (pas d'imports core/shared).
 * PDFKit / qrcode chargés via createRequire (CJS + "type": "module").
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode') as typeof import('qrcode')

/** Helvetica = WinAnsi : normaliser NFD / caractères hors Latin-1. */
function pdfSafeText(input: string): string {
  let s = input.normalize('NFC')
  s = s
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212\u2010\u2011]/g, '-')
    .replace(/[\u00A0\u202F\u2007\u2009]/g, ' ')
    .replace(/[\u0300-\u036f]/g, '')
  s = [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      if (cp <= 0xff) return ch
      const folded = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (folded && [...folded].every((c) => (c.codePointAt(0) ?? 0) <= 0xff)) {
        return folded
      }
      return '?'
    })
    .join('')
  return s
}

export type BadgeLayoutMode = 4 | 6 | 8 | 'custom'

type JudokaLite = {
  id: string
  displayId: string
  lastName: string
  middleName?: string
  firstName: string
  sex: string
  category: string
  weightKg: number | null
  licenseNumber?: string
  photoPath: string | null
}

type BadgeTemplateLite = {
  size: { widthMm: number; heightMm: number }
  backgroundPath?: string | null
  logoPath?: string | null
  colors: {
    primary: string
    secondary: string
    text: string
    band: string
    bandText: string
  }
  layout: {
    logo: { x: number; y: number; width: number; height: number }
    photo: { x: number; y: number; width: number; height: number }
    qrCode: { x: number; y: number; width: number; height: number }
    displayIdBand: { x: number; y: number; width: number; height: number }
    fields: Record<
      string,
      {
        x: number
        y: number
        fontSize: number
        color: string
        align: 'left' | 'center' | 'right'
        maxWidth?: number
        fontFamily: string
      }
    >
  }
}

export interface PdfExportBufferOptions {
  template: BadgeTemplateLite
  judokas: JudokaLite[]
  perPage: BadgeLayoutMode
  customCols?: number
  customRows?: number
  supabaseUrl: string
  serviceRoleKey: string
  siteOrigin?: string
}

const DESIGN_SCALE = 2.5

function mmToPt(mm: number): number {
  return (mm / 25.4) * 72
}

function designCanvas(size: { widthMm: number; heightMm: number }) {
  return { width: size.widthMm * DESIGN_SCALE, height: size.heightMm * DESIGN_SCALE }
}

function resolveGrid(
  perPage: BadgeLayoutMode,
  customCols?: number,
  customRows?: number
): { cols: number; rows: number } {
  if (perPage === 'custom') {
    return { cols: Math.max(1, customCols ?? 2), rows: Math.max(1, customRows ?? 2) }
  }
  if (perPage === 4) return { cols: 2, rows: 2 }
  if (perPage === 6) return { cols: 2, rows: 3 }
  return { cols: 2, rows: 4 }
}

function formatName(j: JudokaLite): string {
  const mid = j.middleName?.trim()
  const left = mid ? `${j.lastName} ${mid}` : j.lastName
  return `${left}, ${j.firstName}`.replace(/\s+/g, ' ').trim()
}

async function resolveImageBuffer(
  path: string | null | undefined,
  supabaseUrl: string,
  serviceRoleKey: string,
  preferred?: 'photos' | 'badge-assets'
): Promise<Buffer | null> {
  if (!path) return null
  try {
    if (path.startsWith('data:')) {
      const b64 = path.split(',')[1]
      return b64 ? Buffer.from(b64, 'base64') : null
    }
    const base = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
    const buckets =
      preferred === 'badge-assets' || path.startsWith('background/') || path.startsWith('logo/')
        ? ['badge-assets', 'photos']
        : ['photos', 'badge-assets']

    for (const b of buckets) {
      const pub = await fetch(`${base}/storage/v1/object/public/${b}/${path}`)
      if (pub.ok) return Buffer.from(await pub.arrayBuffer())
      const auth = await fetch(`${base}/storage/v1/object/authenticated/${b}/${path}`, {
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey }
      })
      if (auth.ok) return Buffer.from(await auth.arrayBuffer())
    }
    return null
  } catch {
    return null
  }
}

async function resolveDefaultLogo(siteOrigin?: string): Promise<Buffer | null> {
  const urls = [
    siteOrigin ? `${siteOrigin.replace(/\/+$/, '')}/brand-logo.png` : null,
    'https://judo-va-capp.vercel.app/brand-logo.png'
  ].filter(Boolean) as string[]
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    } catch {
      /* skip */
    }
  }
  return null
}

function drawField(
  doc: PDFKit.PDFDocument,
  text: string,
  style: BadgeTemplateLite['layout']['fields'][string],
  ox: number,
  oy: number,
  sx: number,
  sy: number,
  opts?: { bgColor?: string; textColor?: string }
): void {
  const safe = pdfSafeText(text)
  if (!safe) return
  const fontSize = style.fontSize * Math.min(sx, sy)
  const font = style.fontFamily?.includes('Bold') ? 'Helvetica-Bold' : 'Helvetica'
  doc.font(font).fontSize(fontSize)
  const x = ox + style.x * sx
  const y = oy + style.y * sy
  const maxW = (style.maxWidth ?? 160) * sx
  const color = opts?.textColor ?? style.color

  if (opts?.bgColor) {
    const textW = doc.widthOfString(safe)
    const padX = 4 * sx
    const padY = 2 * sy
    const bandW = Math.min(maxW, textW + padX * 2)
    let bandX = x
    if (style.align === 'center') bandX = x + (maxW - bandW) / 2
    else if (style.align === 'right') bandX = x + maxW - bandW
    doc.rect(bandX, y - padY, bandW, fontSize + padY * 2).fill(opts.bgColor)
    doc.fillColor(color).text(safe, bandX + padX, y, { lineBreak: false })
  } else {
    doc.fillColor(color).text(safe, x, y, { width: maxW, align: style.align, lineBreak: false })
  }
}

async function drawBadge(
  doc: PDFKit.PDFDocument,
  judoka: JudokaLite,
  template: BadgeTemplateLite,
  ox: number,
  oy: number,
  sx: number,
  sy: number,
  badgeW: number,
  badgeH: number,
  supabaseUrl: string,
  serviceRoleKey: string,
  defaultLogo: Buffer | null
): Promise<void> {
  const bgBuf = await resolveImageBuffer(
    template.backgroundPath,
    supabaseUrl,
    serviceRoleKey,
    'badge-assets'
  )
  if (bgBuf) {
    doc.image(bgBuf, ox, oy, { width: badgeW, height: badgeH })
  } else {
    doc.rect(ox, oy, badgeW, badgeH).fill('#ffffff')
    doc.rect(ox, oy, badgeW, badgeH).stroke(template.colors.primary)
  }

  const photo = template.layout.photo
  const photoX = ox + photo.x * sx
  const photoY = oy + photo.y * sy
  const photoW = photo.width * sx
  const photoH = photo.height * sy
  const radius = Math.min(photoW, photoH) * 0.12
  const photoBuf = await resolveImageBuffer(judoka.photoPath, supabaseUrl, serviceRoleKey, 'photos')

  doc.save()
  doc.roundedRect(photoX, photoY, photoW, photoH, radius).fill('#e2e8f0')
  if (photoBuf) {
    doc.roundedRect(photoX, photoY, photoW, photoH, radius).clip()
    doc.image(photoBuf, photoX, photoY, { cover: [photoW, photoH], align: 'center', valign: 'center' })
  }
  doc.restore()
  doc.roundedRect(photoX, photoY, photoW, photoH, radius).lineWidth(1.5).stroke(template.colors.primary)

  let logoBuf = template.logoPath
    ? await resolveImageBuffer(template.logoPath, supabaseUrl, serviceRoleKey, 'badge-assets')
    : null
  if (!logoBuf) logoBuf = defaultLogo
  if (logoBuf) {
    const logo = template.layout.logo
    const side = Math.max(logo.width, logo.height) * Math.min(sx, sy)
    const cx = ox + logo.x * sx + (logo.width * sx) / 2
    const cy = oy + logo.y * sy + (logo.height * sy) / 2
    const r = side / 2
    doc.save()
    doc.circle(cx, cy, r).clip()
    doc.image(logoBuf, cx - r, cy - r, { width: side, height: side, cover: [side, side] })
    doc.restore()
  }

  const band = template.layout.displayIdBand
  doc
    .rect(ox + band.x * sx, oy + band.y * sy, band.width * sx, band.height * sy)
    .fill(template.colors.band)

  const fields = template.layout.fields
  const values: Record<string, string> = {
    fullName: formatName(judoka),
    category: judoka.category || '',
    weight: judoka.weightKg != null ? `${judoka.weightKg} kg` : '',
    sex: judoka.sex || '',
    displayId: judoka.displayId || ''
  }

  for (const [key, style] of Object.entries(fields)) {
    const text = pdfSafeText(values[key] ?? '')
    if (!text) continue
    if (key === 'displayId') {
      doc
        .font('Helvetica')
        .fontSize(style.fontSize * Math.min(sx, sy))
        .fillColor(template.colors.bandText)
        .text(text, ox + style.x * sx, oy + style.y * sy, {
          width: (style.maxWidth ?? band.width) * sx,
          align: 'center',
          lineBreak: false
        })
      continue
    }
    if (key === 'weight') {
      drawField(doc, text, style, ox, oy, sx, sy, {
        bgColor: template.colors.secondary,
        textColor: '#FFFFFF'
      })
    } else {
      drawField(doc, text, { ...style, color: style.color || template.colors.text }, ox, oy, sx, sy)
    }
  }

  const qr = template.layout.qrCode
  const payload = JSON.stringify({
    id: judoka.id,
    displayId: judoka.displayId,
    name: formatName(judoka),
    license: judoka.licenseNumber ?? ''
  })
  const qrDataUrl = await QRCode.toDataURL(payload, {
    margin: 0,
    width: Math.round(Math.max(32, qr.width * sx * 2)),
    errorCorrectionLevel: 'M'
  })
  const b64 = qrDataUrl.split(',')[1]
  if (b64) {
    doc.image(Buffer.from(b64, 'base64'), ox + qr.x * sx, oy + qr.y * sy, {
      width: qr.width * sx,
      height: qr.height * sy
    })
  }
}

export async function exportBadgesPdfToBuffer(options: PdfExportBufferOptions): Promise<Uint8Array> {
  const { template, judokas, perPage, supabaseUrl, serviceRoleKey, siteOrigin } = options
  const { cols, rows } = resolveGrid(perPage, options.customCols, options.customRows)

  const widthMm = template.size?.widthMm > 0 ? template.size.widthMm : 105
  const heightMm = template.size?.heightMm > 0 ? template.size.heightMm : 148
  const safe = { ...template, size: { widthMm, heightMm } }

  const badgeW = mmToPt(widthMm)
  const badgeH = mmToPt(heightMm)
  const margin = 20
  const gap = 10
  const pageW = margin * 2 + cols * badgeW + (cols - 1) * gap
  const pageH = margin * 2 + rows * badgeH + (rows - 1) * gap

  if (!Number.isFinite(pageW) || !Number.isFinite(pageH) || pageW <= 0 || pageH <= 0) {
    throw new Error('Format de badge invalide — définissez le format dans le Designer.')
  }

  const doc = new PDFDocument({
    size: [pageW, pageH],
    margin: 0,
    autoFirstPage: true,
    info: { Title: 'JudoVACapp — Badges', Author: 'JudoVACapp' }
  })

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', reject)
  })

  const { width: designW, height: designH } = designCanvas(safe.size)
  const scaleX = badgeW / designW
  const scaleY = badgeH / designH
  const defaultLogo = await resolveDefaultLogo(siteOrigin)

  let index = 0
  for (const judoka of judokas) {
    if (index > 0 && index % (cols * rows) === 0) {
      doc.addPage({ size: [pageW, pageH], margin: 0 })
    }
    const slot = index % (cols * rows)
    const col = slot % cols
    const row = Math.floor(slot / cols)
    await drawBadge(
      doc,
      judoka,
      safe,
      margin + col * (badgeW + gap),
      margin + row * (badgeH + gap),
      scaleX,
      scaleY,
      badgeW,
      badgeH,
      supabaseUrl,
      serviceRoleKey,
      defaultLogo
    )
    index++
  }

  if (judokas.length === 0) {
    doc.fontSize(12).fillColor('#64748b').text(pdfSafeText('Aucun judoka à exporter'), margin, margin)
  }

  doc.end()
  await done
  return new Uint8Array(Buffer.concat(chunks))
}

/** Layout A6 par défaut si le modèle en base est incomplet. */
export function defaultBadgeTemplateLite(): BadgeTemplateLite {
  const W = 105 * DESIGN_SCALE
  const H = 148 * DESIGN_SCALE
  const margin = 12
  const logoSize = 42
  const photoW = 95
  const photoH = 115
  const bandH = 22
  const qrSize = 48
  return {
    size: { widthMm: 105, heightMm: 148 },
    backgroundPath: null,
    logoPath: null,
    colors: {
      primary: '#0B1F3A',
      secondary: '#C8102E',
      text: '#0B1F3A',
      band: '#0B1F3A',
      bandText: '#FFFFFF'
    },
    layout: {
      logo: { x: (W - logoSize) / 2, y: margin, width: logoSize, height: logoSize },
      photo: { x: (W - photoW) / 2, y: margin + logoSize + 8, width: photoW, height: photoH },
      qrCode: { x: W - margin - qrSize, y: H - bandH - qrSize - 6, width: qrSize, height: qrSize },
      displayIdBand: { x: 0, y: H - bandH, width: W, height: bandH },
      fields: {
        fullName: {
          x: margin,
          y: margin + logoSize + photoH + 18,
          fontSize: 11,
          color: '#0B1F3A',
          align: 'center',
          maxWidth: W - margin * 2,
          fontFamily: 'Helvetica-Bold'
        },
        category: {
          x: margin,
          y: margin + logoSize + photoH + 34,
          fontSize: 10,
          color: '#0B1F3A',
          align: 'center',
          maxWidth: W - margin * 2,
          fontFamily: 'Helvetica'
        },
        weight: {
          x: margin,
          y: margin + logoSize + photoH + 50,
          fontSize: 10,
          color: '#FFFFFF',
          align: 'center',
          maxWidth: W - margin * 2,
          fontFamily: 'Helvetica-Bold'
        },
        sex: {
          x: margin,
          y: margin + logoSize + photoH + 66,
          fontSize: 10,
          color: '#0B1F3A',
          align: 'center',
          maxWidth: W - margin * 2,
          fontFamily: 'Helvetica'
        },
        displayId: {
          x: 0,
          y: H - bandH + 4,
          fontSize: 9,
          color: '#FFFFFF',
          align: 'center',
          maxWidth: W,
          fontFamily: 'Helvetica'
        }
      }
    }
  }
}
