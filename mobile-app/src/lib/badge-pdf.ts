/**
 * Génération PDF badges simplifiée pour React Native (pdf-lib).
 * Les photos/logos sont passés en data URL déjà chargés.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import QRCode from 'qrcode'
import type { BadgeTemplate } from './badge-defaults'
import type { Judoka } from './client'

function mmToPt(mm: number): number {
  return (mm / 25.4) * 72
}

function hexRgb(hex: string) {
  const h = hex.replace('#', '')
  const n = Number.parseInt(h.slice(0, 6), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** Helvetica = WinAnsi : normaliser NFD / hors Latin-1. */
function pdfSafeText(input: string): string {
  let s = input.normalize('NFC')
  s = s
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212\u2010\u2011]/g, '-')
    .replace(/[\u00A0\u202F\u2007\u2009]/g, ' ')
    .replace(/[\u0300-\u036f]/g, '')
  return [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      if (cp <= 0xff) return ch
      const folded = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (folded && [...folded].every((c) => (c.codePointAt(0) ?? 0) <= 0xff)) return folded
      return '?'
    })
    .join('')
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function embedImage(pdf: PDFDocument, dataUrl: string) {
  const bytes = dataUrlToBytes(dataUrl)
  try {
    return await pdf.embedJpg(bytes)
  } catch {
    return await pdf.embedPng(bytes)
  }
}

export async function buildBadgesPdf(opts: {
  template: BadgeTemplate
  judokas: Judoka[]
  photoDataUrls: Record<string, string | null>
  logoDataUrl?: string | null
  perPage?: 4 | 6 | 8
}): Promise<Uint8Array> {
  const { template, judokas, photoDataUrls, logoDataUrl } = opts
  const perPage = opts.perPage ?? 4
  const cols = 2
  const rows = perPage === 4 ? 2 : perPage === 6 ? 3 : 4

  const widthMm = template.size.widthMm > 0 ? template.size.widthMm : 105
  const heightMm = template.size.heightMm > 0 ? template.size.heightMm : 148
  const badgeW = mmToPt(widthMm)
  const badgeH = mmToPt(heightMm)
  const margin = 20
  const gap = 10
  const pageW = margin * 2 + cols * badgeW + (cols - 1) * gap
  const pageH = margin * 2 + rows * badgeH + (rows - 1) * gap

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let logoImg = null as Awaited<ReturnType<typeof embedImage>> | null
  if (logoDataUrl) {
    try {
      logoImg = await embedImage(pdf, logoDataUrl)
    } catch {
      logoImg = null
    }
  }

  const designW = widthMm * 2.5
  const designH = heightMm * 2.5
  const sx = badgeW / designW
  const sy = badgeH / designH
  const perPageCount = cols * rows

  if (judokas.length === 0) {
    const page = pdf.addPage([pageW, pageH])
    page.drawText('Aucun judoka', { x: margin, y: pageH - 40, size: 12, font, color: hexRgb('#64748b') })
  }

  for (let i = 0; i < judokas.length; i++) {
    if (i % perPageCount === 0) pdf.addPage([pageW, pageH])
    const page = pdf.getPages()[pdf.getPageCount() - 1]!
    const slot = i % perPageCount
    const col = slot % cols
    const row = Math.floor(slot / cols)
    const ox = margin + col * (badgeW + gap)
    const oy = pageH - (margin + row * (badgeH + gap)) - badgeH
    const j = judokas[i]!

    page.drawRectangle({
      x: ox,
      y: oy,
      width: badgeW,
      height: badgeH,
      color: rgb(1, 1, 1),
      borderColor: hexRgb(template.colors.primary),
      borderWidth: 1
    })

    if (logoImg) {
      const logo = template.layout.logo
      const side = Math.max(logo.width, logo.height) * Math.min(sx, sy)
      const cx = ox + logo.x * sx + (logo.width * sx) / 2
      const cy = oy + badgeH - logo.y * sy - (logo.height * sy) / 2
      page.drawImage(logoImg, { x: cx - side / 2, y: cy - side / 2, width: side, height: side })
    }

    const photo = template.layout.photo
    const photoX = ox + photo.x * sx
    const photoW = photo.width * sx
    const photoH = photo.height * sy
    const photoY = oy + badgeH - photo.y * sy - photoH
    page.drawRectangle({
      x: photoX,
      y: photoY,
      width: photoW,
      height: photoH,
      color: hexRgb('#e2e8f0')
    })
    const photoUrl = j.photoPath ? photoDataUrls[j.photoPath] : null
    if (photoUrl) {
      try {
        const img = await embedImage(pdf, photoUrl)
        const scale = Math.min(photoW / img.width, photoH / img.height)
        const dw = img.width * scale
        const dh = img.height * scale
        page.drawImage(img, {
          x: photoX + (photoW - dw) / 2,
          y: photoY + (photoH - dh) / 2,
          width: dw,
          height: dh
        })
      } catch {
        // ignore
      }
    }

    const band = template.layout.displayIdBand
    const bandH = band.height * sy
    page.drawRectangle({
      x: ox + band.x * sx,
      y: oy + badgeH - band.y * sy - bandH,
      width: band.width * sx,
      height: bandH,
      color: hexRgb(template.colors.band)
    })

    const name = `${j.firstName} ${j.lastName}`.trim()
    const fields = [
      { key: 'fullName', text: pdfSafeText(name), bold: true },
      { key: 'category', text: pdfSafeText(j.category), bold: false },
      { key: 'weight', text: j.weightKg != null ? pdfSafeText(`${j.weightKg} kg`) : '', bold: false },
      { key: 'sex', text: pdfSafeText(j.sex), bold: false },
      { key: 'displayId', text: pdfSafeText(j.displayId), bold: false }
    ]
    for (const f of fields) {
      if (!f.text) continue
      const style = template.layout.fields[f.key]
      if (!style) continue
      const size = style.fontSize * Math.min(sx, sy)
      const maxW = (style.maxWidth ?? band.width) * sx
      const textX = ox + style.x * sx
      const textY = oy + badgeH - style.y * sy - size
      const useFont = f.bold ? fontBold : font
      const tw = useFont.widthOfTextAtSize(f.text, size)
      const drawX = textX + (maxW - tw) / 2
      if (f.key === 'weight') {
        page.drawRectangle({
          x: drawX - 4,
          y: textY - 2,
          width: tw + 8,
          height: size + 4,
          color: hexRgb(template.colors.secondary)
        })
        page.drawText(f.text, { x: drawX, y: textY, size, font: fontBold, color: rgb(1, 1, 1) })
      } else if (f.key === 'displayId') {
        page.drawText(f.text, {
          x: drawX,
          y: textY,
          size,
          font,
          color: hexRgb(template.colors.bandText)
        })
      } else {
        page.drawText(f.text, {
          x: drawX,
          y: textY,
          size,
          font: useFont,
          color: hexRgb(template.colors.text)
        })
      }
    }

    try {
      const qrDataUrl = await QRCode.toDataURL(
        JSON.stringify({
          id: j.id,
          displayId: j.displayId,
          name,
          license: j.licenseNumber
        }),
        { margin: 0, width: 128 }
      )
      const qrImg = await embedImage(pdf, qrDataUrl)
      const qr = template.layout.qrCode
      const qrH = qr.height * sy
      page.drawImage(qrImg, {
        x: ox + qr.x * sx,
        y: oy + badgeH - qr.y * sy - qrH,
        width: qr.width * sx,
        height: qrH
      })
    } catch {
      // QR optionnel
    }
  }

  return pdf.save()
}
