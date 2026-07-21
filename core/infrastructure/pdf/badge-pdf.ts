import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { createWriteStream, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { Judoka } from '@shared/types/judoka'
import type { BadgeTemplate, BadgeTextStyle } from '@shared/types/badge'
import { formatBadgeCategory, formatBadgeJudokaName } from '@shared/utils/judoka'
import { badgeDesignCanvas } from '@shared/utils/badge-canvas'

function resolveBrandLogoPath(): string | null {
  const candidates = [
    join(process.resourcesPath || '', 'brand-logo.png'),
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.cwd(), 'build', 'icon.png')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? null
}

export type BadgeLayoutMode = 4 | 6 | 8 | 'custom'

export interface PdfExportOptions {
  outputPath: string
  template: BadgeTemplate
  judokas: Judoka[]
  perPage: BadgeLayoutMode
  customCols?: number
  customRows?: number
}

function mmToPt(mm: number): number {
  return (mm / 25.4) * 72
}

export async function exportBadgesPdf(options: PdfExportOptions): Promise<string> {
  const { outputPath, template, judokas, perPage } = options
  const { cols, rows } = resolveGrid(perPage, options.customCols, options.customRows)

  const badgeW = mmToPt(template.size.widthMm)
  const badgeH = mmToPt(template.size.heightMm)
  const margin = 20
  const gap = 10

  const pageW = margin * 2 + cols * badgeW + (cols - 1) * gap
  const pageH = margin * 2 + rows * badgeH + (rows - 1) * gap

  const doc = new PDFDocument({
    size: [pageW, pageH],
    margin: 0,
    autoFirstPage: true,
    info: { Title: 'JudoVACapp — Badges', Author: 'JudoVACapp' }
  })

  const stream = createWriteStream(outputPath)
  doc.pipe(stream)

  const { width: designW, height: designH } = badgeDesignCanvas(template.size)
  const scaleX = badgeW / designW
  const scaleY = badgeH / designH

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

    await drawBadge(doc, judoka, template, originX, originY, scaleX, scaleY, badgeW, badgeH)
    index++
  }

  if (judokas.length === 0) {
    doc.fontSize(12).fillColor('#64748b').text('Aucun judoka à exporter', margin, margin)
  }

  doc.end()

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve())
    stream.on('error', reject)
  })

  return outputPath
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
  const fontSize = style.fontSize * Math.min(sx, sy)
  const font = style.fontFamily.includes('Bold') ? 'Helvetica-Bold' : 'Helvetica'
  doc.font(font).fontSize(fontSize)
  const x = ox + style.x * sx
  const y = oy + style.y * sy
  const maxW = (style.maxWidth ?? 160) * sx
  const color = opts?.textColor ?? style.color

  if (opts?.bgColor) {
    const textW = doc.widthOfString(text)
    const padX = 4 * sx
    const padY = 2 * sy
    const bandW = Math.min(maxW, textW + padX * 2)
    let bandX = x
    if (style.align === 'center') bandX = x + (maxW - bandW) / 2
    else if (style.align === 'right') bandX = x + maxW - bandW
    doc.rect(bandX, y - padY, bandW, fontSize + padY * 2).fill(opts.bgColor)
    doc.fillColor(color).text(text, bandX + padX, y, { lineBreak: false })
  } else {
    doc.fillColor(color).text(text, x, y, { width: maxW, align: style.align, lineBreak: false })
  }
}

function drawCircularLogo(
  doc: PDFKit.PDFDocument,
  file: string,
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
  doc.image(file, cx - r, cy - r, { width: side, height: side, cover: [side, side] })
  doc.restore()
}

/** Photo judoka découpée dans l’espace réservé, coins arrondis. */
function drawRoundedJudokaPhoto(
  doc: PDFKit.PDFDocument,
  photoPath: string | null | undefined,
  photoX: number,
  photoY: number,
  photoW: number,
  photoH: number,
  borderColor: string
): void {
  const radius = Math.min(photoW, photoH) * 0.12
  doc.save()
  doc.roundedRect(photoX, photoY, photoW, photoH, radius).fill('#e2e8f0')
  if (photoPath && existsSync(photoPath)) {
    doc.roundedRect(photoX, photoY, photoW, photoH, radius).clip()
    doc.image(photoPath, photoX, photoY, {
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
  badgeH: number
): Promise<void> {
  if (template.backgroundPath && existsSync(template.backgroundPath)) {
    doc.image(template.backgroundPath, ox, oy, { width: badgeW, height: badgeH })
  } else {
    doc.rect(ox, oy, badgeW, badgeH).fill('#ffffff')
    doc.rect(ox, oy, badgeW, badgeH).stroke(template.colors.primary)
  }

  const photo = template.layout.photo
  const photoX = ox + photo.x * sx
  const photoY = oy + photo.y * sy
  const photoW = photo.width * sx
  const photoH = photo.height * sy

  drawRoundedJudokaPhoto(
    doc,
    judoka.photoPath,
    photoX,
    photoY,
    photoW,
    photoH,
    template.colors.primary
  )

  const logoFile =
    (template.logoPath && existsSync(template.logoPath) ? template.logoPath : null) ??
    resolveBrandLogoPath()
  if (logoFile) {
    drawCircularLogo(doc, logoFile, ox, oy, sx, sy, template.layout.logo)
  }

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
    const text = values[key] ?? ''
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
    width: Math.round(qr.width * sx * 2),
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

export function defaultExportPath(dir: string, label = 'badges'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(dir, `${label}-${stamp}.pdf`)
}
