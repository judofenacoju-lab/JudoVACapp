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
const MARGIN = 28
const FOOTER_PAD = 12
const HEADER_GRID_GAP = 8

const NAVY = rgb(0.043, 0.122, 0.227)
const RED = rgb(0.784, 0.063, 0.18)
const LINE = rgb(0.043, 0.122, 0.227)
const MUTED = rgb(0.35, 0.4, 0.45)
const WHITE = rgb(1, 1, 1)

const EMPTY_SLOT = '...'

type PdfFont = Awaited<ReturnType<PDFDocument['embedFont']>>

function wrapLines(font: PdfFont, text: string, size: number, maxW: number, maxLines: number): string[] {
  const safe = pdfSafeText(text)
  if (!safe) return []
  if (font.widthOfTextAtSize(safe, size) <= maxW) return [safe]

  const words = safe.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const trial = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) <= maxW) {
      current = trial
      continue
    }
    if (current) {
      lines.push(current)
      if (lines.length >= maxLines) return lines.slice(0, maxLines)
      current = ''
    }
    if (font.widthOfTextAtSize(word, size) <= maxW) {
      current = word
    } else {
      let chunk = ''
      for (const ch of word) {
        const next = chunk + ch
        if (font.widthOfTextAtSize(next, size) > maxW) break
        chunk = next
      }
      lines.push(chunk || word.slice(0, 1))
      current = ''
      if (lines.length >= maxLines) return lines.slice(0, maxLines)
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines.slice(0, maxLines)
}

function slotName(fighter: TirageFighter | null | undefined): string {
  return fighter ? fighter.name : EMPTY_SLOT
}

function fullyVisible(cy: number, halfH: number, top: number, bottom: number): boolean {
  return cy + halfH <= top + 0.5 && cy - halfH >= bottom - 0.5
}

interface BracketLayout {
  boxH: number
  gap: number
  boxW: number
  laterW: number
  connectorW: number
  winnerTail: number
  colH: number
}

function computeLayout(bracket: BracketTree, maxWidth: number, maxHeight: number): BracketLayout {
  const n0 = Math.max(1, bracket.rounds[0]?.length ?? 1)
  const laterRounds = Math.max(0, bracket.rounds.length - 1)

  // Dimensions de base ; on réduit jusqu’à faire tenir TOUTE la grille (→ vainqueur) sur la page
  let boxH = 44
  let gap = 8
  let boxW = 210
  let laterW = 110
  let connectorW = 26
  const winnerTail = 62

  const widthNeeded = () => boxW + laterRounds * (laterW + connectorW) + winnerTail
  const heightNeeded = () => n0 * (boxH + gap) - gap

  while (widthNeeded() > maxWidth && (boxW > 100 || laterW > 48)) {
    if (boxW > 100) boxW -= 4
    if (laterW > 48) laterW -= 3
    if (connectorW > 16) connectorW -= 1
  }

  // Forcer la hauteur : une seule page, case Vainqueur toujours visible
  while (heightNeeded() > maxHeight && (boxH > 12 || gap > 1.5)) {
    if (boxH > 12) boxH -= 0.5
    if (gap > 1.5) gap -= 0.25
  }

  // Si encore trop haut (très grand tableau), compresser proportionnellement
  let colH = heightNeeded()
  if (colH > maxHeight && maxHeight > 40) {
    const scale = maxHeight / colH
    boxH = Math.max(10, boxH * scale)
    gap = Math.max(1, gap * scale)
    colH = n0 * (boxH + gap) - gap
  }

  return {
    boxH,
    gap,
    boxW,
    laterW,
    connectorW,
    winnerTail,
    colH
  }
}

function drawMatchCard(
  page: ReturnType<PDFDocument['addPage']>,
  font: PdfFont,
  fontBold: PdfFont,
  match: BracketMatch,
  x: number,
  cy: number,
  boxW: number,
  boxH: number,
  visibleTop: number,
  visibleBottom: number,
  compact: boolean
): void {
  if (!fullyVisible(cy, boxH / 2, visibleTop, visibleBottom)) return

  const y0 = cy - boxH / 2
  const labelW = Math.min(46, Math.max(36, boxW * 0.22))
  const nameW = boxW - labelW
  const nameSize = compact ? 5.5 : boxH >= 36 ? 7 : 6
  const metaSize = compact ? 4.5 : 5.5
  const labelSize = compact ? 5.5 : 6.5
  const textMaxW = nameW - 6

  page.drawRectangle({
    x,
    y: y0,
    width: boxW,
    height: boxH,
    borderColor: NAVY,
    borderWidth: 0.8,
    color: WHITE
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
    thickness: 0.55,
    color: NAVY
  })

  const drawSlot = (fighter: TirageFighter | null, slotTop: number, slotBottom: number) => {
    const mid = (slotTop + slotBottom) / 2
    if (!fighter) {
      page.drawText(EMPTY_SLOT, {
        x: x + 3,
        y: mid - nameSize / 3,
        size: nameSize,
        font: fontBold,
        color: NAVY
      })
      return
    }

    const nameLines = wrapLines(fontBold, slotName(fighter), nameSize, textMaxW, compact ? 1 : 2)
    const showMeta = !compact && boxH >= 30
    const metaLine = showMeta
      ? wrapLines(font, formatFighterMeta(fighter), metaSize, textMaxW, 1)[0]
      : undefined

    const lineGap = 1.2
    const blockH =
      nameLines.length * nameSize +
      Math.max(0, nameLines.length - 1) * lineGap +
      (metaLine ? metaSize + 2 : 0)
    let y = mid + blockH / 2 - nameSize

    for (const line of nameLines) {
      page.drawText(line, {
        x: x + 3,
        y,
        size: nameSize,
        font: fontBold,
        color: NAVY
      })
      y -= nameSize + lineGap
    }
    if (metaLine) {
      page.drawText(metaLine, {
        x: x + 3,
        y: y - 1,
        size: metaSize,
        font,
        color: MUTED
      })
    }
  }

  drawSlot(match.top.fighter, cy + boxH / 2, cy)
  drawSlot(match.bottom.fighter, cy, cy - boxH / 2)

  const label = pdfSafeText(match.label)
  const lw = fontBold.widthOfTextAtSize(label, labelSize)
  page.drawText(label, {
    x: x + nameW + Math.max(1, (labelW - lw) / 2),
    y: cy - labelSize / 3,
    size: labelSize,
    font: fontBold,
    color: WHITE
  })
}

function drawBracketSlice(
  page: ReturnType<PDFDocument['addPage']>,
  font: PdfFont,
  fontBold: PdfFont,
  bracket: BracketTree,
  layout: BracketLayout,
  originX: number,
  originTop: number,
  yShift: number,
  visibleTop: number,
  visibleBottom: number
): void {
  const rounds = bracket.rounds
  if (!rounds.length) return

  const { boxH, boxW, laterW, connectorW, colH } = layout
  const compact = boxH < 30

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
      drawMatchCard(
        page,
        font,
        fontBold,
        round[i]!,
        x,
        matchCenterY(i, count),
        colWidth,
        boxH,
        visibleTop,
        visibleBottom,
        compact
      )
    }

    const nextX = x + colWidth

    if (r < rounds.length - 1) {
      const pairs = count / 2
      for (let p = 0; p < pairs; p++) {
        const topCy = matchCenterY(p * 2, count)
        const botCy = matchCenterY(p * 2 + 1, count)
        const midCy = (topCy + botCy) / 2
        if (
          !fullyVisible(topCy, 1, visibleTop, visibleBottom) &&
          !fullyVisible(botCy, 1, visibleTop, visibleBottom)
        ) {
          continue
        }
        const clipY = (y: number) => Math.min(visibleTop, Math.max(visibleBottom, y))
        const x0 = nextX
        const x1 = nextX + connectorW * 0.42
        const x2 = nextX + connectorW
        const tY = clipY(topCy)
        const bY = clipY(botCy)
        const mY = clipY(midCy)
        page.drawLine({ start: { x: x0, y: tY }, end: { x: x1, y: tY }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x0, y: bY }, end: { x: x1, y: bY }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x1, y: tY }, end: { x: x1, y: bY }, thickness: 1, color: LINE })
        page.drawLine({ start: { x: x1, y: mY }, end: { x: x2, y: mY }, thickness: 1, color: LINE })
      }
      x = nextX + connectorW
    } else {
      const cy = matchCenterY(0, count)
      if (fullyVisible(cy, 10, visibleTop, visibleBottom)) {
        const x0 = nextX
        page.drawLine({
          start: { x: x0, y: cy },
          end: { x: x0 + 24, y: cy },
          thickness: 1,
          color: LINE
        })
        page.drawText(pdfSafeText('Vainqueur'), {
          x: x0 + 28,
          y: cy - 2.5,
          size: Math.min(8, Math.max(6, boxH * 0.2)),
          font: fontBold,
          color: RED
        })
      }
    }
  }
}

function measurePoolHeaderHeight(opts: {
  showDocTitle: boolean
  showCategoryTitle: boolean
}): number {
  let h = HEADER_GRID_GAP
  if (opts.showDocTitle) h += 26
  else h += 14
  h += 14 // trait
  if (opts.showCategoryTitle) {
    h += 18 // titre catégorie
    h += 16 // meta
  } else {
    h += 12
  }
  return h
}

function poolCategoryKey(pool: TiragePool): string {
  return `${pool.sex}::${pool.category}::${pool.weightLabel}`
}

function drawPageHeader(
  page: ReturnType<PDFDocument['addPage']>,
  font: PdfFont,
  fontBold: PdfFont,
  pool: TiragePool,
  pageIndex: number,
  pageCount: number,
  showDocTitle: boolean,
  showCategoryTitle: boolean
): void {
  let y = PAGE_H - MARGIN

  if (showDocTitle) {
    page.drawText(pdfSafeText('JudoVACapp - Grille de combats'), {
      x: MARGIN,
      y: y - 14,
      size: 16,
      font: fontBold,
      color: NAVY
    })
  }

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

  y -= showDocTitle ? 26 : 14

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: NAVY
  })
  y -= 14

  if (showCategoryTitle) {
    // Une seule fois : sexe · catégorie d’âge (sans min/max) · libellé de poids
    const title = `${pool.sexLabel} · ${pool.category} · ${pool.weightLabel}`
    const titleLines = wrapLines(fontBold, title, 11, PAGE_W - MARGIN * 2, 2)
    for (const line of titleLines) {
      page.drawText(line, {
        x: MARGIN,
        y: y - 10,
        size: 11,
        font: fontBold,
        color: NAVY
      })
      y -= 13
    }
    y -= 2
    page.drawText(
      pdfSafeText(`${pool.entrantCount} judoka(s) · tableau ${pool.bracket.size}`),
      {
        x: MARGIN,
        y: y - 8,
        size: 8,
        font,
        color: MUTED
      }
    )
  } else if (pageCount > 1) {
    page.drawText(pdfSafeText('Suite de la grille'), {
      x: MARGIN,
      y: y - 8,
      size: 9,
      font,
      color: MUTED
    })
  }
}

/**
 * PDF A4 paysage : 1 page par grille (complète jusqu’au vainqueur) ; sans seuils d’âge.
 */
export async function exportTirageBracketPdfBytes(
  pools: TiragePool[],
  _meta?: { filtersLabel?: string }
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

  const contentBottom = FOOTER_PAD
  const maxBracketWidth = PAGE_W - MARGIN * 2
  let isFirstDocPage = true
  const shownCategoryTitles = new Set<string>()

  for (const pool of pools) {
    const categoryKey = poolCategoryKey(pool)
    const page = doc.addPage([PAGE_W, PAGE_H])

    const showDocTitle = isFirstDocPage
    isFirstDocPage = false

    const showCategoryTitle = !shownCategoryTitles.has(categoryKey)
    if (showCategoryTitle) shownCategoryTitles.add(categoryKey)

    const headerH = measurePoolHeaderHeight({
      showDocTitle,
      showCategoryTitle
    })
    const contentTop = PAGE_H - MARGIN - headerH
    const availableH = Math.max(80, contentTop - contentBottom)

    // Une seule page : toute la grille redimensionnée pour afficher la case Vainqueur
    const layout = computeLayout(pool.bracket, maxBracketWidth, availableH)

    drawBracketSlice(
      page,
      font,
      fontBold,
      pool.bracket,
      layout,
      MARGIN,
      contentTop,
      0,
      contentTop,
      contentBottom
    )

    page.drawRectangle({
      x: 0,
      y: contentTop,
      width: PAGE_W,
      height: PAGE_H - contentTop,
      color: WHITE,
      borderWidth: 0
    })
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: contentBottom,
      color: WHITE,
      borderWidth: 0
    })

    drawPageHeader(
      page,
      font,
      fontBold,
      pool,
      0,
      1,
      showDocTitle,
      showCategoryTitle
    )

    page.drawLine({
      start: { x: MARGIN, y: contentTop + 2 },
      end: { x: PAGE_W - MARGIN, y: contentTop + 2 },
      thickness: 0.5,
      color: rgb(0.75, 0.8, 0.85)
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
