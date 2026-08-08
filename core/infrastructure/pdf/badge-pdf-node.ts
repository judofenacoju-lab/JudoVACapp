import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import type { Judoka } from '../../shared/types/judoka'
import type { BadgeTemplate, BadgeTextStyle } from '../../shared/types/badge'
import { formatBadgeCategory, formatBadgeJudokaName } from '../../shared/utils/judoka'
import { badgeDesignCanvas } from '../../shared/utils/badge-canvas'
import { pdfSafeText } from '../../shared/utils/pdf-winansi-text'

export type BadgeLayoutMode = 4 | 6 | 8 | 'custom'

export interface PdfExportBufferOptions {
  template: BadgeTemplate
  judokas: Judoka[]
  perPage: BadgeLayoutMode
  customCols?: number
  customRows?: number
  supabaseUrl: string
  serviceRoleKey: string
  /** Origine du site (ex. https://judo-va-capp.vercel.app) pour le logo par défaut. */
  siteOrigin?: string
}

function mmToPt(mm: number): number {
  return (mm / 25.4) * 72
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

function formatWeight(judoka: Judoka): string {
  if (judoka.weightKg != null) return `${judoka.weightKg} kg`
  return ''
}

async function resolveImageBuffer(
  path: string | null | undefined,
  supabaseUrl: string,
  serviceRoleKey: string,
  preferredBucket?: 'photos' | 'badge-assets'
): Promise<Buffer | null> {
  if (!path) return null
  try {
    if (path.startsWith('data:')) {
      const b64 = path.split(',')[1]
      return b64 ? Buffer.from(b64, 'base64') : null
    }
    const base = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
    const buckets =
      preferredBucket === 'badge-assets'
        ? ['badge-assets', 'photos']
        : preferredBucket === 'photos'
          ? ['photos', 'badge-assets']
          : path.startsWith('background/') || path.startsWith('logo/')
            ? ['badge-assets', 'photos']
            : ['photos', 'badge-assets']

    for (const b of buckets) {
      const storageUrl = `${base}/storage/v1/object/public/${b}/${path}`
      const pub = await fetch(storageUrl)
      if (pub.ok) return Buffer.from(await pub.arrayBuffer())
      const authUrl = `${base}/storage/v1/object/authenticated/${b}/${path}`
      const res = await fetch(authUrl, {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey
        }
      })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    }
    return null
  } catch {
    return null
  }
}

async function resolveDefaultLogoBuffer(siteOrigin?: string): Promise<Buffer | null> {
  const candidates = [
    siteOrigin ? `${siteOrigin.replace(/\/+$/, '')}/brand-logo.png` : null,
    'https://judo-va-capp.vercel.app/brand-logo.png'
  ].filter(Boolean) as string[]
  for (const url of candidates) {
    try {
      const res = await fetch(url)
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    } catch {
      /* continue */
    }
  }
  return null
}

function drawBadgeField(
  doc: PDFKit.PDFDocument,
  text: string,
  style: BadgeTextStyle,
  ox: number,
  oy: number,
  sx: number,
  sy: number,
  opts?: { bgColor?: string; textColor?: string }
): void {
  const safe = pdfSafeText(text)
  if (!safe) return
  const fontSize = style.fontSize * Math.min(sx, sy)
  const font = style.fontFamily.includes('Bold') ? 'Helvetica-Bold' : 'Helvetica'
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

function drawCircularLogo(
  doc: PDFKit.PDFDocument,
  buf: Buffer,
  ox: number,
  oy: number,
  sx: number,
  sy: number,
  logo: BadgeTemplate['layout']['logo']
): void {
  const side = Math.max(logo.width, logo.height) * Math.min(sx, sy)
  const cx = ox + logo.x * sx + (logo.width * sx) / 2
  const cy = oy + logo.y * sy + (logo.height * sy) / 2
  const r = side / 2
  doc.save()
  doc.circle(cx, cy, r).clip()
  doc.image(buf, cx - r, cy - r, { width: side, height: side, cover: [side, side] })
  doc.restore()
}

function drawRoundedJudokaPhoto(
  doc: PDFKit.PDFDocument,
  photoBuf: Buffer | null,
  photoX: number,
  photoY: number,
  photoW: number,
  photoH: number,
  borderColor: string
): void {
  const radius = Math.min(photoW, photoH) * 0.12
  doc.save()
  doc.roundedRect(photoX, photoY, photoW, photoH, radius).fill('#e2e8f0')
  if (photoBuf) {
    doc.roundedRect(photoX, photoY, photoW, photoH, radius).clip()
    doc.image(photoBuf, photoX, photoY, {
      cover: [photoW, photoH],
      align: 'center',
      valign: 'center'
    })
  }
  doc.restore()
  doc.roundedRect(photoX, photoY, photoW, photoH, radius).lineWidth(1.5).stroke(borderColor)
}

async function drawBadge(
  doc: PDFKit.PDFDocument,
  judoka: Judoka,
  template: BadgeTemplate,
  ox: number,
  oy: number,
  sx: number,
  sy: number,
  badgeW: number,
  badgeH: number,
  supabaseUrl: string,
  serviceRoleKey: string,
  defaultLogoBuf: Buffer | null
): Promise<void> {
  const bgBuf = template.backgroundPath
    ? await resolveImageBuffer(
        template.backgroundPath,
        supabaseUrl,
        serviceRoleKey,
        'badge-assets'
      )
    : null

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

  const photoBuf = await resolveImageBuffer(judoka.photoPath, supabaseUrl, serviceRoleKey, 'photos')
  drawRoundedJudokaPhoto(doc, photoBuf, photoX, photoY, photoW, photoH, template.colors.primary)

  let logoBuf: Buffer | null = null
  if (template.logoPath) {
    logoBuf = await resolveImageBuffer(
      template.logoPath,
      supabaseUrl,
      serviceRoleKey,
      'badge-assets'
    )
  }
  if (!logoBuf) logoBuf = defaultLogoBuf
  if (logoBuf) drawCircularLogo(doc, logoBuf, ox, oy, sx, sy, template.layout.logo)

  const band = template.layout.displayIdBand
  doc
    .rect(ox + band.x * sx, oy + band.y * sy, band.width * sx, band.height * sy)
    .fill(template.colors.band)

  const fields = template.layout.fields
  const values: Record<string, string> = {
    fullName: formatBadgeJudokaName(judoka),
    category: formatBadgeCategory(judoka.category),
    weight: formatWeight(judoka),
    sex: judoka.sex,
    displayId: judoka.displayId
  }

  for (const [key, style] of Object.entries(fields)) {
    const text = pdfSafeText(values[key] ?? '')
    if (!text) continue
    if (key === 'displayId') {
      const fontSize = style.fontSize * Math.min(sx, sy)
      doc
        .font('Helvetica')
        .fontSize(fontSize)
        .fillColor(template.colors.bandText)
        .text(text, ox + style.x * sx, oy + style.y * sy, {
          width: (style.maxWidth ?? band.width) * sx,
          align: 'center',
          lineBreak: false
        })
      continue
    }
    if (key === 'weight') {
      drawBadgeField(doc, text, style, ox, oy, sx, sy, {
        bgColor: template.colors.secondary,
        textColor: '#FFFFFF'
      })
    } else {
      drawBadgeField(
        doc,
        text,
        { ...style, color: style.color || template.colors.text },
        ox,
        oy,
        sx,
        sy
      )
    }
  }

  const qr = template.layout.qrCode
  const payload = JSON.stringify({
    id: judoka.id,
    displayId: judoka.displayId,
    name: formatBadgeJudokaName(judoka),
    license: judoka.licenseNumber
  })
  const qrDataUrl = await QRCode.toDataURL(payload, {
    margin: 0,
    width: Math.round(Math.max(32, qr.width * sx * 2)),
    errorCorrectionLevel: 'M'
  })
  const b64 = qrDataUrl.split(',')[1]
  if (b64) {
    const buf = Buffer.from(b64, 'base64')
    doc.image(buf, ox + qr.x * sx, oy + qr.y * sy, {
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
  const safeTemplate: BadgeTemplate = {
    ...template,
    size: { widthMm, heightMm }
  }

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

  const { width: designW, height: designH } = badgeDesignCanvas(safeTemplate.size)
  const scaleX = badgeW / designW
  const scaleY = badgeH / designH
  const defaultLogoBuf = await resolveDefaultLogoBuffer(siteOrigin)

  let index = 0
  for (const judoka of judokas) {
    if (index > 0 && index % (cols * rows) === 0) {
      doc.addPage({ size: [pageW, pageH], margin: 0 })
    }

    const slot = index % (cols * rows)
    const col = slot % cols
    const row = Math.floor(slot / cols)
    const originX = margin + col * (badgeW + gap)
    const originY = margin + row * (badgeH + gap)

    await drawBadge(
      doc,
      judoka,
      safeTemplate,
      originX,
      originY,
      scaleX,
      scaleY,
      badgeW,
      badgeH,
      supabaseUrl,
      serviceRoleKey,
      defaultLogoBuf
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
