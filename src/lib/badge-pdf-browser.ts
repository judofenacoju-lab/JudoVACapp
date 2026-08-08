/**
 * Génération PDF badges côté navigateur (pdf-lib) —
 * contourne les crashes PDFKit sur Vercel serverless.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'
import type { BadgeTemplate } from '@shared/types/badge'
import type { Judoka } from '@shared/types/judoka'
import { formatBadgeJudokaName } from '@shared/utils/judoka'
import { pdfSafeText } from '@shared/utils/pdf-winansi-text'
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

function formatName(j: Pick<Judoka, 'lastName' | 'firstName'>): string {
  return formatBadgeJudokaName(j)
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

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = src
  })
}

/** Photo : cover dans un rectangle aux coins arrondis (PNG, sans contour). */
async function toRoundedCoverPng(
  src: string,
  outW: number,
  outH: number,
  radius: number
): Promise<string> {
  const img = await loadHtmlImage(src)
  const w = Math.max(1, Math.round(outW))
  const h = Math.max(1, Math.round(outH))
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')

  ctx.clearRect(0, 0, w, h)
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(w, 0, w, h, r)
  ctx.arcTo(w, h, 0, h, r)
  ctx.arcTo(0, h, 0, 0, r)
  ctx.arcTo(0, 0, w, 0, r)
  ctx.closePath()
  ctx.clip()

  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return canvas.toDataURL('image/png')
}

/** Logo circulaire (comme l’aperçu), fond blanc. */
async function toCircularLogoPng(src: string, size: number): Promise<string> {
  const img = await loadHtmlImage(src)
  const s = Math.max(1, Math.round(size))
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')

  ctx.clearRect(0, 0, s, s)
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, s, s)

  const scale = Math.max(s / img.width, s / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (s - dw) / 2, (s - dh) / 2, dw, dh)
  return canvas.toDataURL('image/png')
}

async function embedPngFromDataUrl(pdf: PDFDocument, dataUrl: string): Promise<PDFImage> {
  return pdf.embedPng(await toBytes(dataUrl))
}

async function resolveSourceDataUrl(
  path: string,
  readDataUrl: (path: string) => Promise<string | null>
): Promise<string | null> {
  if (path.startsWith('data:')) return path
  if (path.startsWith('http') || path.startsWith('/')) {
    const bytes = await toBytes(path)
    const blob = new Blob([new Uint8Array(bytes)])
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(new Error('Lecture image impossible'))
      r.readAsDataURL(blob)
    })
  }
  return readDataUrl(path)
}

async function loadRoundedPhoto(
  pdf: PDFDocument,
  path: string | null | undefined,
  readDataUrl: (path: string) => Promise<string | null>,
  outW: number,
  outH: number,
  radius: number
): Promise<PDFImage | null> {
  if (!path) return null
  try {
    const src = await resolveSourceDataUrl(path, readDataUrl)
    if (!src) return null
    const png = await toRoundedCoverPng(src, outW * 2, outH * 2, radius * 2)
    return await embedPngFromDataUrl(pdf, png)
  } catch (e) {
    console.warn('[badge-pdf] photo non embarquée:', path, e)
    return null
  }
}

async function loadCircularLogo(
  pdf: PDFDocument,
  path: string | null | undefined,
  readDataUrl: (path: string) => Promise<string | null>,
  size: number,
  fallbackSrc?: string
): Promise<PDFImage | null> {
  const trySrc = async (src: string) => {
    const png = await toCircularLogoPng(src, Math.max(64, Math.round(size * 2)))
    return embedPngFromDataUrl(pdf, png)
  }
  try {
    if (path) {
      const src = await resolveSourceDataUrl(path, readDataUrl)
      if (src) return await trySrc(src)
    }
  } catch (e) {
    console.warn('[badge-pdf] logo custom non embarqué:', path, e)
  }
  if (fallbackSrc) {
    try {
      return await trySrc(fallbackSrc)
    } catch (e) {
      console.warn('[badge-pdf] logo défaut non embarqué', e)
    }
  }
  return null
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
  const safe = pdfSafeText(text)
  if (!safe) return
  const width = opts?.maxWidth
  const textW = font.widthOfTextAtSize(safe, size)
  let drawX = x
  if (width != null && opts?.align === 'center') drawX = x + (width - textW) / 2
  else if (width != null && opts?.align === 'right') drawX = x + width - textW
  page.drawText(safe, {
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

  const logoLayout = template.layout.logo
  const logoSide = Math.max(logoLayout.width, logoLayout.height) * Math.min(sx, sy)
  const logoImg = await loadCircularLogo(
    pdf,
    template.logoPath,
    readDataUrl,
    logoSide,
    brandLogoUrl
  )

  let bgImg: PDFImage | null = null
  if (template.backgroundPath) {
    try {
      const src = await resolveSourceDataUrl(template.backgroundPath, readDataUrl)
      if (src) {
        const img = await loadHtmlImage(src)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(badgeW * 2)
        canvas.height = Math.round(badgeH * 2)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          bgImg = await embedPngFromDataUrl(pdf, canvas.toDataURL('image/png'))
        }
      }
    } catch {
      bgImg = null
    }
  }

  const perPageCount = cols * rows
  let page: PDFPage | null = null

  if (judokas.length === 0) {
    page = pdf.addPage([pageW, pageH])
    page.drawText(pdfSafeText('Aucun judoka à exporter'), {
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
      logoSide,
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
    logoSide: number
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
    logoSide,
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
  const radius = Math.min(photoW, photoH) * 0.12

  const photoImg = await loadRoundedPhoto(
    pdf,
    judoka.photoPath,
    readDataUrl,
    photoW,
    photoH,
    radius
  )

  // Fond du cadre (si pas de photo) — sans contour noir
  if (!photoImg) {
    page.drawRectangle({
      x: photoX,
      y: photoY,
      width: photoW,
      height: photoH,
      color: hexRgb('#e2e8f0')
    })
  } else {
    page.drawImage(photoImg, {
      x: photoX,
      y: photoY,
      width: photoW,
      height: photoH
    })
  }

  if (logoImg) {
    const logo = template.layout.logo
    const cx = ox + logo.x * sx + (logo.width * sx) / 2
    const cy = oy + badgeH - logo.y * sy - (logo.height * sy) / 2
    page.drawImage(logoImg, {
      x: cx - logoSide / 2,
      y: cy - logoSide / 2,
      width: logoSide,
      height: logoSide
    })
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
    fullName: pdfSafeText(formatName(judoka)),
    category: pdfSafeText(judoka.category || ''),
    weight: judoka.weightKg != null ? pdfSafeText(`${judoka.weightKg} kg`) : '',
    sex: pdfSafeText(judoka.sex || ''),
    displayId: pdfSafeText(judoka.displayId || '')
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
    const qrImg = await pdf.embedPng(await toBytes(qrDataUrl))
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
