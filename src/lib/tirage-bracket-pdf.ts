import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import {
  formatFighterMeta,
  type BracketMatch,
  type BracketTree,
  type TirageFighter,
  type TiragePool
} from '@shared/utils/tirage'
import { downloadBytes } from './download-blob'
import { pdfSafeText } from './pdf-winansi-text'

/** A4 paysage (mm → pt). */
const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 36

const NAVY = rgb(0.043, 0.122, 0.227)
const RED = rgb(0.784, 0.063, 0.18)
const LINE = rgb(0.043, 0.122, 0.227)
const MUTED = rgb(0.35, 0.4, 0.45)

const EMPTY_SLOT = '...'

/** Hauteur lisible d’une case combat (nom + club/poids) — pas de compression agressive. */
const BOX_H = 38
const BOX_GAP = 10
const BOX_W = 168
const LATER_W = 150
const CONNECTOR_W = 42
const WINNER_TAIL = 78

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

function slotName(fighter: TirageFighter | null | undefined): string {
  return fighter ? fighter.name : EMPTY_SLOT
}

function inVisibleRange(cy: number, halfH: number, top: number, bottom: number): boolean {
  return cy + halfH >= bottom && cy - halfH <= top
}

function drawMatchCard(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  match: BracketMatch,
  x: number,
  cy: number,
  boxW: number,
  boxH: number,
  visibleTop: number,
  visibleBottom: number
): void {
  if (!inVisibleRange(cy, boxH / 2, visibleTop, visibleBottom)) return

  const y0 = cy - boxH / 2
  const labelW = 48
  const nameW = boxW - labelW
  const nameSize = 7.5
  const metaSize = 5.5
  const labelSize = 6.5

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

  const drawSlot = (fighter: TirageFighter | null, midY: number) => {
    page.drawText(truncate(font, slotName(fighter), nameSize, nameW - 8), {
      x: x + 4,
      y: midY + (fighter ? 3 : -nameSize / 3),
      size: nameSize,
      font,
      color: NAVY
    })
    if (fighter) {
      page.drawText(truncate(font, formatFighterMeta(fighter), metaSize, nameW - 8), {
        x: x + 4,
        y: midY - 7,
        size: metaSize,
        font,
        color: MUTED
      })
    }
  }

  drawSlot(match.top.fighter, cy + boxH / 4)
  drawSlot(match.bottom.fighter, cy - boxH / 4)

  const label = pdfSafeText(match.label)
  const lw = fontBold.widthOfTextAtSize(label, labelSize)
  page.drawText(label, {
    x: x + nameW + Math.max(2, (labelW - lw) / 2),
    y: cy + (match.bye ? 2 : -labelSize / 3),
    size: labelSize,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
  if (match.bye) {
    const bye = pdfSafeText('bye')
    const bw = font.widthOfTextAtSize(bye, 5)
    page.drawText(bye, {
      x: x + nameW + Math.max(2, (labelW - bw) / 2),
      y: cy - 8,
      size: 5,
      font,
      color: rgb(0.85, 0.9, 0.95)
    })
  }
}

/**
 * Dessine la grille à taille lisible fixe. `yShift` décale le contenu pour la pagination verticale.
 */
function drawBracketSlice(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  bracket: BracketTree,
  originX: number,
  originTop: number,
  yShift: number,
  visibleTop: number,
  visibleBottom: number,
  maxWidth: number
): number {
  const rounds = bracket.rounds
  if (!rounds.length) return 0

  const first = rounds[0]!
  const n0 = first.length
  const boxH = BOX_H
  const gap = BOX_GAP
  const colH = n0 * (boxH + gap) - gap

  const laterRounds = Math.max(0, rounds.length - 1)
  let boxW = BOX_W
  let laterW = LATER_W
  let connectorW = CONNECTOR_W
  const needed = () => boxW + laterRounds * (laterW + connectorW) + WINNER_TAIL
  while (needed() > maxWidth && (boxW > 112 || laterW > 96)) {
    boxW = Math.max(112, boxW - 4)
    laterW = Math.max(96, laterW - 4)
    connectorW = Math.max(28, connectorW - 1)
  }

  const matchCenterY = (matchIndex: number, count: number): number => {
    const slotH = colH / count
    return originTop + yShift - matchIndex * slotH - slotH / 2
  }

  let x = originX

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r]!
    const count = round.length
    const colWidth = r === 0 ? boxW : laterW

    for (let i = 0; i < count; i++) {
      const cy = matchCenterY(i, count)
      drawMatchCard(
        page,
        font,
        fontBold,
        round[i]!,
        x,
        cy,
        colWidth,
        boxH,
        visibleTop,
        visibleBottom
      )
    }

    const nextX = x + colWidth

    if (r < rounds.length - 1) {
      const pairs = count / 2
      for (let p = 0; p < pairs; p++) {
        const topCy = matchCenterY(p * 2, count)
        const botCy = matchCenterY(p * 2 + 1, count)
        const midCy = (topCy + botCy) / 2
        if (!inVisibleRange(midCy, Math.abs(topCy - botCy) / 2 + 4, visibleTop, visibleBottom)) {
          continue
        }
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
      if (inVisibleRange(cy, 20, visibleTop, visibleBottom)) {
        const x0 = nextX
        page.drawLine({
          start: { x: x0, y: cy },
          end: { x: x0 + 28, y: cy },
          thickness: 1,
          color: LINE
        })
        page.drawText(pdfSafeText('Vainqueur'), {
          x: x0 + 32,
          y: cy + 4,
          size: 8,
          font: fontBold,
          color: RED
        })
        const final = round[0]!
        const winner =
          final.top.fighter && !final.bottom.fighter
            ? final.top.fighter
            : final.bottom.fighter && !final.top.fighter
              ? final.bottom.fighter
              : null
        if (winner) {
          page.drawText(truncate(font, winner.name, 7, WINNER_TAIL - 4), {
            x: x0 + 32,
            y: cy - 8,
            size: 7,
            font,
            color: NAVY
          })
        }
      }
    }
  }

  return colH
}

function drawPageChrome(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  pool: TiragePool,
  meta: { filtersLabel?: string } | undefined,
  pageIndex: number,
  pageCount: number
): number {
  let y = PAGE_H - MARGIN

  page.drawText(pdfSafeText('JudoVACapp - Grille de combats'), {
    x: MARGIN,
    y: y - 14,
    size: 16,
    font: fontBold,
    color: NAVY
  })
  if (pageCount > 1) {
    const pageLabel = pdfSafeText(`Page ${pageIndex + 1}/${pageCount}`)
    const pw = font.widthOfTextAtSize(pageLabel, 9)
    page.drawText(pageLabel, {
      x: PAGE_W - MARGIN - pw,
      y: y - 12,
      size: 9,
      font,
      color: MUTED
    })
  }
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

  page.drawText(pdfSafeText('Format A4 paysage - JudoVACapp'), {
    x: MARGIN,
    y: 14,
    size: 7,
    font,
    color: MUTED
  })

  return y
}

/**
 * PDF A4 paysage : grille lisible, découpée sur plusieurs pages si nécessaire.
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
    const n0 = pool.bracket.rounds[0]?.length ?? 0
    const colH = n0 > 0 ? n0 * (BOX_H + BOX_GAP) - BOX_GAP : 0

    // Estimer la zone utile après en-tête (même chrome sur chaque page)
    const probe = doc.addPage([PAGE_W, PAGE_H])
    const contentTop = drawPageChrome(probe, font, fontBold, pool, meta, 0, 1)
    doc.removePage(doc.getPageCount() - 1)

    const contentBottom = MARGIN + 22
    const availableH = Math.max(80, contentTop - contentBottom)
    const pageCount = Math.max(1, Math.ceil(colH / availableH) || 1)

    for (let p = 0; p < pageCount; p++) {
      const page = doc.addPage([PAGE_W, PAGE_H])
      const originTop = drawPageChrome(page, font, fontBold, pool, meta, p, pageCount)
      const yShift = p * availableH
      drawBracketSlice(
        page,
        font,
        fontBold,
        pool.bracket,
        MARGIN,
        originTop,
        yShift,
        originTop,
        contentBottom,
        PAGE_W - MARGIN * 2
      )
    }
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
