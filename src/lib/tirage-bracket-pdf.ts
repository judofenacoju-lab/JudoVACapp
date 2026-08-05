import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { BracketMatch, BracketTree, TiragePool } from '@shared/utils/tirage'
import { downloadBytes } from './download-blob'
import { pdfSafeText } from './pdf-winansi-text'

/** A4 paysage (mm → pt) — idéal pour une grille de combats. */
const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 36

const NAVY = rgb(0.043, 0.122, 0.227)
const RED = rgb(0.784, 0.063, 0.18)
const LINE = rgb(0.043, 0.122, 0.227)
const MIST = rgb(0.91, 0.933, 0.961)
const MUTED = rgb(0.35, 0.4, 0.45)

const EMPTY_SLOT = '...'

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

function slotName(fighterName: string | undefined | null, empty: boolean): string {
  if (fighterName) return fighterName
  if (empty) return EMPTY_SLOT
  return EMPTY_SLOT
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
  const y0 = cy - boxH / 2
  const labelW = Math.max(44, Math.min(58, boxW * 0.32))
  const nameW = boxW - labelW
  const nameSize = boxH >= 26 ? 8 : 7
  const labelSize = boxH >= 26 ? 7 : 6

  page.drawRectangle({
    x,
    y: y0,
    width: boxW,
    height: boxH,
    borderColor: NAVY,
    borderWidth: 0.9,
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
    thickness: 0.6,
    color: NAVY
  })

  const topName = slotName(match.top.fighter?.name, match.top.empty)
  const bottomName = slotName(match.bottom.fighter?.name, match.bottom.empty)

  page.drawText(truncate(font, topName, nameSize, nameW - 8), {
    x: x + 4,
    y: cy + boxH / 4 - nameSize / 3,
    size: nameSize,
    font,
    color: NAVY
  })
  page.drawText(truncate(font, bottomName, nameSize, nameW - 8), {
    x: x + 4,
    y: cy - boxH / 4 - nameSize / 3,
    size: nameSize,
    font,
    color: NAVY
  })

  const label = pdfSafeText(match.label)
  const lw = fontBold.widthOfTextAtSize(label, labelSize)
  page.drawText(label, {
    x: x + nameW + Math.max(2, (labelW - lw) / 2),
    y: cy - labelSize / 3,
    size: labelSize,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
}

function drawLaterBadge(
  page: ReturnType<PDFDocument['addPage']>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  match: BracketMatch,
  x: number,
  cy: number,
  badgeW: number,
  badgeH: number
): void {
  page.drawRectangle({
    x: x - badgeW / 2,
    y: cy - badgeH / 2,
    width: badgeW,
    height: badgeH,
    borderColor: NAVY,
    borderWidth: 0.8,
    color: MIST
  })
  const label = pdfSafeText(match.label)
  const size = 7
  const lw = fontBold.widthOfTextAtSize(label, size)
  page.drawText(label, {
    x: x - lw / 2,
    y: cy - size / 3,
    size,
    font: fontBold,
    color: NAVY
  })
}

/**
 * Dessine la grille en l’adaptant à la zone A4 disponible (marges comprises).
 */
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
  const roundCount = rounds.length

  // Dimensions proportionnelles pour tenir sur A4 paysage
  const usableH = Math.max(120, maxHeight - 8)
  const boxH = Math.min(32, Math.max(16, usableH / n0 - 3))
  const gap = Math.max(2, (usableH - n0 * boxH) / Math.max(n0, 1))
  const colH = n0 * (boxH + gap) - gap

  const connectorW = Math.min(48, maxWidth * 0.08)
  const laterW = 38
  const winnerTail = 70
  const laterRounds = Math.max(0, roundCount - 1)
  const reserved = laterRounds * (laterW + connectorW) + winnerTail + 8
  const boxW = Math.min(168, Math.max(110, maxWidth - reserved))

  const matchCenterY = (matchIndex: number, count: number): number => {
    const slotH = colH / count
    return originTop - matchIndex * slotH - slotH / 2
  }

  let x = originX

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r]!
    const count = round.length

    for (let i = 0; i < count; i++) {
      const cy = matchCenterY(i, count)
      if (r === 0) {
        drawFirstMatch(page, font, fontBold, round[i]!, x, cy, boxW, boxH)
      } else {
        drawLaterBadge(page, fontBold, round[i]!, x + laterW / 2, cy, laterW - 4, Math.min(18, boxH * 0.7))
      }
    }

    const colWidth = r === 0 ? boxW : laterW
    const nextX = x + colWidth

    if (r < rounds.length - 1) {
      const pairs = count / 2
      for (let p = 0; p < pairs; p++) {
        const topCy = matchCenterY(p * 2, count)
        const botCy = matchCenterY(p * 2 + 1, count)
        const midCy = (topCy + botCy) / 2
        const x0 = nextX
        const x1 = nextX + connectorW * 0.42
        const x2 = nextX + connectorW
        page.drawLine({ start: { x: x0, y: topCy }, end: { x: x1, y: topCy }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x0, y: botCy }, end: { x: x1, y: botCy }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x1, y: topCy }, end: { x: x1, y: botCy }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x1, y: midCy }, end: { x: x2, y: midCy }, thickness: 1, color: LINE })
      }
      x = nextX + connectorW
    } else {
      const cy = matchCenterY(0, count)
      const x0 = nextX
      page.drawLine({
        start: { x: x0, y: cy },
        end: { x: x0 + 36, y: cy },
        thickness: 1,
        color: LINE
      })
      page.drawText(pdfSafeText('Vainqueur'), {
        x: x0 + 40,
        y: cy - 2.5,
        size: 9,
        font: fontBold,
        color: RED
      })
    }
  }
}

/**
 * PDF A4 paysage : une page bien cadrée par groupe de la grille.
 */
export async function exportTirageBracketPdfBytes(
  pools: TiragePool[],
  meta?: { filtersLabel?: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  if (pools.length === 0) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    page.drawText(pdfSafeText('Aucune grille a exporter pour les filtres choisis.'), {
      x: MARGIN,
      y: PAGE_H / 2,
      size: 12,
      font,
      color: NAVY
    })
    return doc.save()
  }

  for (const pool of pools) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    let y = PAGE_H - MARGIN

    // En-tête
    page.drawText(pdfSafeText('JudoVACapp - Grille de combats'), {
      x: MARGIN,
      y: y - 14,
      size: 16,
      font: fontBold,
      color: NAVY
    })
    y -= 26

    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 1,
      color: NAVY
    })
    y -= 16

    const title = `${pool.sexLabel} · ${pool.category} · ${pool.weightLabel}`
    page.drawText(truncate(fontBold, title, 12, PAGE_W - MARGIN * 2), {
      x: MARGIN,
      y: y - 10,
      size: 12,
      font: fontBold,
      color: NAVY
    })
    y -= 20

    if (meta?.filtersLabel) {
      page.drawText(truncate(font, meta.filtersLabel, 9, PAGE_W - MARGIN * 2), {
        x: MARGIN,
        y: y - 8,
        size: 9,
        font,
        color: MUTED
      })
      y -= 14
    }

    page.drawText(
      pdfSafeText(
        `${pool.entrantCount} judoka(s) · tableau ${pool.bracket.size} · ${new Date().toLocaleString('fr-FR')}`
      ),
      {
        x: MARGIN,
        y: y - 8,
        size: 8,
        font,
        color: MUTED
      }
    )
    y -= 18

    // Zone utile pour la grille (reste de la page A4)
    const bottom = MARGIN + 12
    drawBracketOnPage(
      page,
      font,
      fontBold,
      pool.bracket,
      MARGIN,
      y,
      PAGE_W - MARGIN * 2,
      y - bottom
    )

    // Pied de page
    page.drawText(pdfSafeText('Format A4 paysage - JudoVACapp'), {
      x: MARGIN,
      y: 14,
      size: 7,
      font,
      color: MUTED
    })
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
