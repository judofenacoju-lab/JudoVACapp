/**
 * Génération PDF badges côté navigateur (pdf-lib) —
 * contourne les crashes PDFKit sur Vercel serverless.
 */
import {
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage
} from 'pdf-lib'
import QRCode from 'qrcode'
import type { BadgeTemplate } from '@shared/types/badge'
import type { Judoka } from '@shared/types/judoka'
import brandLogoUrl from '@/assets/brand-logo.png'

const DESIGN_SCALE = 2.5

export type BadgeLayoutMode = 4 | 6 | 8 | 'custom'

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

function formatName(j: Pick<Judoka, 'lastName' | 'middleName' | 'firstName'>): string {
  const mid = j.middleName?.trim()
  const left = mid ? `${j.lastName} ${mid}` : j.lastName
  return `${left}, ${j.firstName}`.replace(/\s+/g, ' ').trim()
}

function hexRgb(hex: string): ReturnType<typeof rgb> {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(n)) return rgb(0.04, 0.12, 0.23)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

async function toBytes(src: string): Promise<Uint8Array> {
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',')
    if (comma < 0) throw new Error('data URL invalide')
    const b64 = src.slice(comma + 1)
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Image inaccessible (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Toujours ré-encoder en JPEG via canvas (fiable pour pdf-lib). */
async function toJpegDataUrl(src: string, maxSide = 1200, quality = 0.88): Promise<string> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas indisponible'))
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = src
  })
}

async function embedAny(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  try {
    return await pdf.embedJpg(bytes)
  } catch {
    return await pdf.embedPng(bytes)
  }
}

async function embedFromSrc(pdf: PDFDocument, src: string): Promise<PDFImage> {
  const jpegUrl = await toJpegDataUrl(src)
  return await embedAny(pdf, await toBytes(jpegUrl))
}

async function loadOptionalImage(
  pdf: PDFDocument,
  path: string | null | undefined,
  readDataUrl: (path: string) => Promise<string | null>
): Promise<PDFImage | null> {
  if (!path) return null
  try {
    let src = path
    if (!path.startsWith('data:') && !path.startsWith('http') && !path.startsWith('/')) {
      const loaded = await readDataUrl(path)
      if (!loaded) return null
      src = loaded
    } else if (path.startsWith('http') || path.startsWith('/')) {
      // Charger via fetch → data URL pour éviter CORS canvas
      const bytes = await toBytes(path)
      const blob = new Blob([new Uint8Array(bytes)])
      src = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(new Error('Lecture image impossible'))
        r.readAsDataURL(blob)
      })
    }
    return await embedFromSrc(pdf, src)
  } catch (e) {
    console.warn('[badge-pdf] image non embarquée:', path, e)
    return null
  }
}

/** Remplit le cadre sans déborder (contain). */
function drawCoverImage(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const scale = Math.min(w / image.width, h / image.height)
  const dw = image.width * scale
  const dh = image.height * scale
  page.drawImage(image, {
    x: x + (w - dw) / 2,
    y: y + (h - dh) / 2,
    width: dw,
    height: dh
  })
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  yBottom: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  opts?: { maxWidth?: number; align?: 'left' | 'center' | 'right' }
): void {
  const width = opts?.maxWidth
  const textW = font.widthOfTextAtSize(text, size)
  let drawX = x
  if (width != null && opts?.align === 'center') drawX = x + (width - textW) / 2
  else if (width != null && opts?.align === 'right') drawX = x + width - textW
  page.drawText(text, {
    x: Math.max(0, drawX),
    y: yBottom,
    size,
    font,
    color,
    maxWidth: width
  })
}

export interface BrowserPdfExportOptions {
  template: BadgeTemplate
  judokas: Judoka[]
  perPage: BadgeLayoutMode
  customCols?: number
  customRows?: number
  readDataUrl: (path: string) => Promise<string | null>
}

export async function exportBadgesPdfBytes(options: BrowserPdfExportOptions): Promise<Uint8Array> {
  const { template, judokas, perPage, readDataUrl } = options
  const { cols, rows } = resolveGrid(perPage, options.customCols, options.customRows)

  const widthMm = template.size?.widthMm > 0 ? template.size.widthMm : 105
  const heightMm = template.size?.heightMm > 0 ? template.size.heightMm : 148
  const badgeW = mmToPt(widthMm)
  const badgeH = mmToPt(heightMm)
  const margin = 20
  const gap = 10
  const pageW = margin * 2 + cols * badgeW + (cols - 1) * gap
  const pageH = margin * 2 + rows * badgeH + (rows - 1) * gap

  if (!Number.isFinite(pageW) || !Number.isFinite(pageH) || pageW <= 0 || pageH <= 0) {
    throw new Error('Format de badge invalide — définissez le format dans le Designer.')
  }

  const pdf = await PDFDocument.create()
  pdf.setTitle('JudoVACapp — Badges')
  pdf.setAuthor('JudoVACapp')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const { width: designW, height: designH } = designCanvas({ widthMm, heightMm })
  const sx = badgeW / designW
  const sy = badgeH / designH

  let defaultLogo: PDFImage | null = null
  try {
    defaultLogo = await embedFromSrc(pdf, brandLogoUrl)
  } catch {
    defaultLogo = null
  }

  const bgImg = await loadOptionalImage(pdf, template.backgroundPath, readDataUrl)
  let logoImg = await loadOptionalImage(pdf, template.logoPath, readDataUrl)
  if (!logoImg) logoImg = defaultLogo

  const perPageCount = cols * rows
  let page: PDFPage | null = null

  if (judokas.length === 0) {
    page = pdf.addPage([pageW, pageH])
    page.drawText('Aucun judoka à exporter', {
      x: margin,
      y: pageH - margin - 14,
      size: 12,
      font,
      color: hexRgb('#64748b')
    })
  }

  for (let index = 0; index < judokas.length; index++) {
    if (index % perPageCount === 0) {
      page = pdf.addPage([pageW, pageH])
    }
    const slot = index % perPageCount
    const col = slot % cols
    const row = Math.floor(slot / cols)
    const ox = margin + col * (badgeW + gap)
    const oyTop = margin + row * (badgeH + gap)
    // pdf-lib : y=0 en bas
    const oy = pageH - oyTop - badgeH

    await drawBadge(page!, {
      judoka: judokas[index]!,
      template,
      ox,
      oy,
      badgeW,
      badgeH,
      sx,
      sy,
      font,
      fontBold,
      bgImg,
      logoImg,
      readDataUrl,
      pdf
    })
  }

  return pdf.save()
}

async function drawBadge(
  page: PDFPage,
  ctx: {
    judoka: Judoka
    template: BadgeTemplate
    ox: number
    oy: number
    badgeW: number
    badgeH: number
    sx: number
    sy: number
    font: PDFFont
    fontBold: PDFFont
    bgImg: PDFImage | null
    logoImg: PDFImage | null
    readDataUrl: (path: string) => Promise<string | null>
    pdf: PDFDocument
  }
): Promise<void> {
  const {
    judoka,
    template,
    ox,
    oy,
    badgeW,
    badgeH,
    sx,
    sy,
    font,
    fontBold,
    bgImg,
    logoImg,
    readDataUrl,
    pdf
  } = ctx

  if (bgImg) {
    page.drawImage(bgImg, { x: ox, y: oy, width: badgeW, height: badgeH })
  } else {
    page.drawRectangle({
      x: ox,
      y: oy,
      width: badgeW,
      height: badgeH,
      color: rgb(1, 1, 1),
      borderColor: hexRgb(template.colors.primary),
      borderWidth: 1
    })
  }

  const photo = template.layout.photo
  const photoX = ox + photo.x * sx
  const photoW = photo.width * sx
  const photoH = photo.height * sy
  const photoY = oy + badgeH - photo.y * sy - photoH

  const photoImg = judoka.photoPath
    ? await loadOptionalImage(pdf, judoka.photoPath, readDataUrl)
    : null

  // Cadre : gris si pas de photo, sinon fond blanc + image
  page.drawRectangle({
    x: photoX,
    y: photoY,
    width: photoW,
    height: photoH,
    color: photoImg ? rgb(1, 1, 1) : hexRgb('#e2e8f0'),
    borderColor: hexRgb(template.colors.primary),
    borderWidth: 1.5
  })

  if (photoImg) {
    drawCoverImage(page, photoImg, photoX, photoY, photoW, photoH)
    page.drawRectangle({
      x: photoX,
      y: photoY,
      width: photoW,
      height: photoH,
      borderColor: hexRgb(template.colors.primary),
      borderWidth: 1.5
    })
  }

  if (logoImg) {
    const logo = template.layout.logo
    const side = Math.max(logo.width, logo.height) * Math.min(sx, sy)
    const cx = ox + logo.x * sx + (logo.width * sx) / 2
    const cy = oy + badgeH - logo.y * sy - (logo.height * sy) / 2
    drawCoverImage(page, logoImg, cx - side / 2, cy - side / 2, side, side)
  }

  const band = template.layout.displayIdBand
  const bandH = band.height * sy
  const bandY = oy + badgeH - band.y * sy - bandH
  page.drawRectangle({
    x: ox + band.x * sx,
    y: bandY,
    width: band.width * sx,
    height: bandH,
    color: hexRgb(template.colors.band)
  })

  const fields = template.layout.fields
  const values: Record<string, string> = {
    fullName: formatName(judoka),
    category: judoka.category || '',
    weight: judoka.weightKg != null ? `${judoka.weightKg} kg` : '',
    sex: judoka.sex || '',
    displayId: judoka.displayId || ''
  }

  for (const [key, style] of Object.entries(fields)) {
    const text = values[key] ?? ''
    if (!text) continue
    const size = style.fontSize * Math.min(sx, sy)
    const maxW = (style.maxWidth ?? band.width) * sx
    const textX = ox + style.x * sx
    const textY = oy + badgeH - style.y * sy - size

    if (key === 'displayId') {
      drawText(page, text, textX, textY, font, size, hexRgb(template.colors.bandText), {
        maxWidth: maxW,
        align: 'center'
      })
      continue
    }

    if (key === 'weight') {
      const padX = 4 * sx
      const padY = 2 * sy
      const tw = fontBold.widthOfTextAtSize(text, size)
      page.drawRectangle({
        x: textX + (maxW - tw) / 2 - padX,
        y: textY - padY,
        width: tw + padX * 2,
        height: size + padY * 2,
        color: hexRgb(template.colors.secondary)
      })
      drawText(page, text, textX, textY, fontBold, size, rgb(1, 1, 1), {
        maxWidth: maxW,
        align: 'center'
      })
      continue
    }

    const useBold = key === 'fullName' || style.fontFamily?.includes('Bold')
    drawText(
      page,
      text,
      textX,
      textY,
      useBold ? fontBold : font,
      size,
      hexRgb(style.color || template.colors.text),
      { maxWidth: maxW, align: style.align }
    )
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
    width: Math.round(Math.max(64, qr.width * sx * 2)),
    errorCorrectionLevel: 'M'
  })
  try {
    const qrImg = await embedAny(pdf, await toBytes(qrDataUrl))
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
