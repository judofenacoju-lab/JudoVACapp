import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { BracketMatch, BracketTree, TiragePool } from '@shared/utils/tirage'
import { downloadBytes } from './download-blob'
import { pdfSafeText } from './pdf-winansi-text'

const NAVY = rgb(0.043, 0.122, 0.227)
const RED = rgb(0.784, 0.063, 0.18)
const LINE = rgb(0.043, 0.122, 0.227)
const MIST = rgb(0.91, 0.933, 0.961)

function truncate(
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  text: string,
  size: number,
  maxW: number
): string {
  const safe = pdfSafeText(text)
  if (font.widthOfTextAtSize(safe, size) <= maxW) return safe
  let t = safe
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxW) {
    t = t.slice(0, -1)
  }
  return `${t}...`
}

function drawFirstMatch(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  match: BracketMatch,
  x: number,
  cy: number,
  boxW: number,
  boxH: number
): void {
  const top = cy + boxH / 2
  const y0 = top - boxH
  const labelW = 52
  const nameW = boxW - labelW

  page.drawRectangle({
    x,
    y: y0,
    width: boxW,
    height: boxH,
    borderColor: NAVY,
    borderWidth: 0.8,
    color: rgb(1, 1, 1)
  })
  page.drawRectangle({
    x: x + nameW,
    y: y0,
    width: labelW,
    height: boxH,
    color: NAVY
  })
  page.drawLine({
    start: { x, y: cy },
    end: { x: x + nameW, y: cy },
    thickness: 0.5,
    color: NAVY
  })

  const topName = match.top.fighter?.name ?? '—'
  const bottomName =
    match.bye && match.bottom.empty ? 'Exempt' : (match.bottom.fighter?.name ?? '—')

  page.drawText(truncate(font, topName, 7, nameW - 6), {
    x: x + 3,
    y: cy + boxH / 4 - 2,
    size: 7,
    font,
    color: NAVY
  })
  page.drawText(truncate(font, bottomName, 7, nameW - 6), {
    x: x + 3,
    y: cy - boxH / 4 - 2,
    size: 7,
    font,
    color: NAVY
  })

  const label = pdfSafeText(match.label)
  const lw = fontBold.widthOfTextAtSize(label, 6)
  page.drawText(label, {
    x: x + nameW + (labelW - lw) / 2,
    y: cy - 2,
    size: 6,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
}

function drawLaterBadge(
  page: ReturnType<PDFDocument['addPage']>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  match: BracketMatch,
  x: number,
  cy: number
): void {
  const w = 36
  const h = 16
  page.drawRectangle({
    x: x - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    borderColor: NAVY,
    borderWidth: 0.7,
    color: MIST
  })
  const label = pdfSafeText(match.label)
  const lw = fontBold.widthOfTextAtSize(label, 7)
  page.drawText(label, {
    x: x - lw / 2,
    y: cy - 2.5,
    size: 7,
    font: fontBold,
    color: NAVY
  })
}

function drawBracketOnPage(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  bracket: BracketTree,
  originX: number,
  originTop: number,
  maxWidth: number,
  maxHeight: number
): void {
  const rounds = bracket.rounds
  if (!rounds.length) return

  const first = rounds[0]!
  const n0 = first.length
  const boxH = Math.min(28, Math.max(18, (maxHeight - 20) / n0 - 4))
  const gap = Math.max(4, (maxHeight - n0 * boxH) / Math.max(n0, 1))
  const colH = n0 * (boxH + gap) - gap
  const boxW = Math.min(150, maxWidth * 0.28)
  const connectorW = Math.min(55, maxWidth * 0.1)
  const laterW = 40

  const matchCenterY = (_roundIdx: number, matchIndex: number, count: number): number => {
    const slotH = colH / count
    return originTop - matchIndex * slotH - slotH / 2
  }

  let x = originX

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r]!
    const count = round.length

    for (let i = 0; i < count; i++) {
      const cy = matchCenterY(r, i, count)
      if (r === 0) {
        drawFirstMatch(page, font, fontBold, round[i]!, x, cy, boxW, boxH)
      } else {
        drawLaterBadge(page, fontBold, round[i]!, x + laterW / 2, cy)
      }
    }

    const colWidth = r === 0 ? boxW : laterW
    const nextX = x + colWidth

    if (r < rounds.length - 1) {
      const pairs = count / 2
      for (let p = 0; p < pairs; p++) {
        const topCy = matchCenterY(r, p * 2, count)
        const botCy = matchCenterY(r, p * 2 + 1, count)
        const midCy = (topCy + botCy) / 2
        const x0 = nextX
        const x1 = nextX + connectorW * 0.45
        const x2 = nextX + connectorW
        page.drawLine({ start: { x: x0, y: topCy }, end: { x: x1, y: topCy }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x0, y: botCy }, end: { x: x1, y: botCy }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x1, y: topCy }, end: { x: x1, y: botCy }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x1, y: midCy }, end: { x: x2, y: midCy }, thickness: 1, color: LINE })
      }
      x = nextX + connectorW
    } else {
      const cy = matchCenterY(r, 0, count)
      const x0 = nextX
      page.drawLine({
        start: { x: x0, y: cy },
        end: { x: x0 + 40, y: cy },
        thickness: 1,
        color: LINE
      })
      page.drawText(pdfSafeText('Vainqueur'), {
        x: x0 + 44,
        y: cy - 2,
        size: 8,
        font: fontBold,
        color: RED
      })
    }
  }
}

/**
 * PDF paysage : une page (ou plus) par groupe visible de la grille de combats.
 */
export async function exportTirageBracketPdfBytes(
  pools: TiragePool[],
  meta?: { filtersLabel?: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  if (pools.length === 0) {
    const page = doc.addPage([842, 595])
    page.drawText(pdfSafeText('Aucune grille a exporter pour les filtres choisis.'), {
      x: 40,
      y: 300,
      size: 12,
      font,
      color: NAVY
    })
    return doc.save()
  }

  for (const pool of pools) {
    const page = doc.addPage([842, 595]) // A4 paysage
    const margin = 28
    let y = 595 - margin

    page.drawText(pdfSafeText('JudoVACapp — Grille de combats'), {
      x: margin,
      y: y - 12,
      size: 14,
      font: fontBold,
      color: NAVY
    })
    y -= 28

    const title = `${pool.sexLabel} · ${pool.category} · ${pool.weightLabel}`
    page.drawText(truncate(fontBold, title, 11, 780), {
      x: margin,
      y: y - 10,
      size: 11,
      font: fontBold,
      color: NAVY
    })
    y -= 22

    if (meta?.filtersLabel) {
      page.drawText(truncate(font, meta.filtersLabel, 8, 780), {
        x: margin,
        y: y - 8,
        size: 8,
        font,
        color: rgb(0.35, 0.4, 0.45)
      })
      y -= 16
    }

    page.drawText(
      pdfSafeText(
        `${pool.entrantCount} judoka(s) · tableau ${pool.bracket.size} · export ${new Date().toLocaleString('fr-FR')}`
      ),
      {
        x: margin,
        y: y - 8,
        size: 8,
        font,
        color: rgb(0.35, 0.4, 0.45)
      }
    )
    y -= 20

    drawBracketOnPage(
      page,
      font,
      fontBold,
      pool.bracket,
      margin,
      y,
      842 - margin * 2,
      y - margin
    )
  }

  return doc.save()
}

export async function exportAndDownloadTirageBracketPdf(
  pools: TiragePool[],
  meta?: { filtersLabel?: string }
): Promise<{ filename: string; poolCount: number }> {
  const bytes = await exportTirageBracketPdfBytes(pools, meta)
  const filename = `grille-combats-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadBytes(bytes, filename, 'application/pdf')
  return { filename, poolCount: pools.length }
}
