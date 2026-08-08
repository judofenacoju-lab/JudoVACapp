import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import {
  formatFighterMeta,
  formatTirageCategoryName,
  type BracketMatch,
  type BracketTree,
  type TirageFighter,
  type TiragePool
} from '@shared/utils/tirage'
import { downloadBytes } from './download-blob'
import { pdfSafeText } from './pdf-winansi-text'

/** A4 paysage. */
const PAGE_W = 841.89
const PAGE_H = 595.28
const MARGIN = 24

const NAVY = rgb(0.043, 0.122, 0.227)
const RED = rgb(0.784, 0.063, 0.18)
const LINE = rgb(0.043, 0.122, 0.227)
const MUTED = rgb(0.35, 0.4, 0.45)
const WHITE = rgb(1, 1, 1)

const EMPTY_SLOT = '...'

/**
 * Max de combats du 1er tour par page PDF.
 * Au-delà (ex. tableau 256 → 128 combats R1), la grille continue sur la page suivante.
 */
const MAX_FIRST_ROUND_MATCHES_PER_PAGE = 64

type PdfFont = Awaited<ReturnType<PDFDocument['embedFont']>>

/**
 * Extrait la sous-grille couvrant les combats du 1er tour [r0Start, r0End)
 * (sous-arbre autonome jusqu’au vainqueur local de cette partie).
 */
function sliceBracketTree(
  bracket: BracketTree,
  r0Start: number,
  r0End: number
): BracketTree {
  const rounds: BracketMatch[][] = []
  let start = r0Start
  let end = r0End

  for (let r = 0; r < bracket.rounds.length; r++) {
    const source = bracket.rounds[r]
    if (!source || end <= start) break
    const sliced = source.slice(start, Math.min(end, source.length))
    if (sliced.length === 0) break
    rounds.push(sliced)
    // Vainqueur local de cette partie : on n’inclut pas le tour suivant (fusion hors page)
    if (sliced.length === 1) break
    start = Math.floor(start / 2)
    end = Math.ceil(end / 2)
  }

  const r0Count = rounds[0]?.length ?? 0
  return {
    rounds,
    size: Math.max(r0Count * 2, 2),
    entrantCount: bracket.entrantCount
  }
}

/** Découpe un tableau en parties de ≤ 64 combats au 1er tour. */
function bracketPageSlices(bracket: BracketTree): Array<{ start: number; end: number }> {
  const n0 = bracket.rounds[0]?.length ?? 0
  if (n0 <= 0) return [{ start: 0, end: 0 }]
  if (n0 <= MAX_FIRST_ROUND_MATCHES_PER_PAGE) {
    return [{ start: 0, end: n0 }]
  }
  const slices: Array<{ start: number; end: number }> = []
  for (let start = 0; start < n0; start += MAX_FIRST_ROUND_MATCHES_PER_PAGE) {
    slices.push({
      start,
      end: Math.min(start + MAX_FIRST_ROUND_MATCHES_PER_PAGE, n0)
    })
  }
  return slices
}

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

/** Titre pool sans aucun seuil d’âge min/max. */
function poolTitleWithoutAgeThresholds(pool: TiragePool): string {
  const category = formatTirageCategoryName(pool.category)
    // Filet de sécurité : retirer toute plage numérique type âge encore présente
    .replace(/\b\d{1,2}\s*[-–/à]\s*\d{1,2}(\s*ans)?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const weight = (pool.weightLabel || '')
    .replace(/\(\s*\d+([.,]\d+)?\s*[-–]\s*\d+([.,]\d+)?\s*kg\s*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return [pool.sexLabel, category || pool.category, weight].filter(Boolean).join(' · ')
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

/**
 * Calcule un layout qui tient ENTIÈREMENT dans maxWidth × maxHeight
 * (aucune case combat hors page).
 */
function computeLayout(bracket: BracketTree, maxWidth: number, maxHeight: number): BracketLayout {
  const n0 = Math.max(1, bracket.rounds[0]?.length ?? 1)
  const laterRounds = Math.max(0, bracket.rounds.length - 1)

  let boxH = Math.min(40, maxHeight / Math.max(n0, 1) - 2)
  let gap = Math.min(6, Math.max(1.5, boxH * 0.12))
  let boxW = 200
  let laterW = 100
  let connectorW = 24
  let winnerTail = 58

  const widthNeeded = () => boxW + laterRounds * (laterW + connectorW) + winnerTail
  const heightNeeded = () => n0 * (boxH + gap) - gap

  // Largeur : toutes les colonnes jusqu’au vainqueur
  let guard = 0
  while (widthNeeded() > maxWidth && guard < 80) {
    guard += 1
    if (boxW > 90) boxW -= 3
    else if (laterW > 42) laterW -= 2
    else if (connectorW > 14) connectorW -= 1
    else if (winnerTail > 40) winnerTail -= 2
    else break
  }

  // Hauteur : toutes les lignes du 1er tour
  guard = 0
  while (heightNeeded() > maxHeight && guard < 120) {
    guard += 1
    if (boxH > 11) boxH -= 0.4
    if (gap > 1) gap -= 0.15
  }

  let colH = heightNeeded()
  if (colH > maxHeight && maxHeight > 30) {
    const scale = (maxHeight - 1) / colH
    boxH = Math.max(9, boxH * scale)
    gap = Math.max(0.8, gap * scale)
    colH = n0 * (boxH + gap) - gap
  }

  // Garantir que rien ne dépasse la bande utile
  if (colH > maxHeight) {
    colH = maxHeight
    boxH = Math.max(8, (colH + gap) / n0 - gap)
  }

  return { boxH, gap, boxW, laterW, connectorW, winnerTail, colH }
}

function drawMatchCard(
  page: ReturnType<PDFDocument['addPage']>,
  font: PdfFont,
  fontBold: PdfFont,
  match: BracketMatch,
  x: number,
  cy: number,
  boxW: number,
  boxH: number
): void {
  const y0 = cy - boxH / 2
  const labelW = Math.min(42, Math.max(32, boxW * 0.2))
  const nameW = boxW - labelW
  const compact = boxH < 28
  const nameSize = compact ? 5 : boxH >= 34 ? 7 : 6
  const metaSize = 4.5
  const labelSize = compact ? 5 : 6
  const textMaxW = Math.max(20, nameW - 5)

  page.drawRectangle({
    x,
    y: y0,
    width: boxW,
    height: boxH,
    borderColor: NAVY,
    borderWidth: 0.7,
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
    thickness: 0.5,
    color: NAVY
  })

  const drawSlot = (fighter: TirageFighter | null, slotMid: number) => {
    if (!fighter) {
      page.drawText(EMPTY_SLOT, {
        x: x + 3,
        y: slotMid - nameSize / 3,
        size: nameSize,
        font: fontBold,
        color: NAVY
      })
      return
    }

    const nameLines = wrapLines(fontBold, fighter.name, nameSize, textMaxW, compact ? 1 : 2)
    const showMeta = !compact && boxH >= 28
    const metaLine = showMeta
      ? wrapLines(font, formatFighterMeta(fighter), metaSize, textMaxW, 1)[0]
      : undefined

    const lineGap = 1
    const blockH =
      nameLines.length * nameSize +
      Math.max(0, nameLines.length - 1) * lineGap +
      (metaLine ? metaSize + 1.5 : 0)
    let y = slotMid + blockH / 2 - nameSize

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
        y: y - 0.5,
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
    x: x + nameW + Math.max(1, (labelW - lw) / 2),
    y: cy - labelSize / 3,
    size: labelSize,
    font: fontBold,
    color: WHITE
  })
}

function drawFullBracket(
  page: ReturnType<PDFDocument['addPage']>,
  font: PdfFont,
  fontBold: PdfFont,
  bracket: BracketTree,
  layout: BracketLayout,
  originX: number,
  originTop: number
): void {
  const rounds = bracket.rounds
  if (!rounds.length) return

  const { boxH, boxW, laterW, connectorW, colH } = layout

  const matchCenterY = (matchIndex: number, count: number): number => {
    const slotH = colH / count
    return originTop - matchIndex * slotH - slotH / 2
  }

  let x = originX

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r]!
    const count = round.length
    const colWidth = r === 0 ? boxW : laterW

    for (let i = 0; i < count; i++) {
      // Toutes les cases sont dessinées (pas de filtrage qui coupe des combats)
      drawMatchCard(
        page,
        font,
        fontBold,
        round[i]!,
        x,
        matchCenterY(i, count),
        colWidth,
        boxH
      )
    }

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
        page.drawLine({ start: { x: x0, y: topCy }, end: { x: x1, y: topCy }, thickness: 0.9, color: LINE })
        page.drawLine({ start: { x: x0, y: botCy }, end: { x: x1, y: botCy }, thickness: 0.9, color: LINE })
        page.drawLine({ start: { x: x1, y: topCy }, end: { x: x1, y: botCy }, thickness: 0.9, color: LINE })
        page.drawLine({ start: { x: x1, y: midCy }, end: { x: x2, y: midCy }, thickness: 0.9, color: LINE })
      }
      x = nextX + connectorW
    } else {
      const cy = matchCenterY(0, count)
      const x0 = nextX
      page.drawLine({
        start: { x: x0, y: cy },
        end: { x: x0 + 22, y: cy },
        thickness: 0.9,
        color: LINE
      })
      page.drawText(pdfSafeText('Vainqueur'), {
        x: x0 + 26,
        y: cy - 2.5,
        size: Math.min(8, Math.max(5.5, boxH * 0.22)),
        font: fontBold,
        color: RED
      })
    }
  }
}

/**
 * Dessine l’en-tête et renvoie le Y bas de la zone titres (début de la grille).
 * N’affiche jamais les seuils d’âge min/max.
 */
function drawHeaderAndGetGridTop(
  page: ReturnType<PDFDocument['addPage']>,
  font: PdfFont,
  fontBold: PdfFont,
  pool: TiragePool,
  showDocTitle: boolean,
  partInfo?: { part: number; totalParts: number; matchFrom: number; matchTo: number }
): number {
  let y = PAGE_H - MARGIN

  if (showDocTitle) {
    page.drawText(pdfSafeText('JudoVACapp - Grille de combats'), {
      x: MARGIN,
      y: y - 12,
      size: 14,
      font: fontBold,
      color: NAVY
    })
    y -= 22
  }

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: NAVY
  })
  y -= 14

  const title = poolTitleWithoutAgeThresholds(pool)
  const titleLines = wrapLines(fontBold, title, 11, PAGE_W - MARGIN * 2, 2)
  for (const line of titleLines) {
    page.drawText(line, {
      x: MARGIN,
      y: y - 9,
      size: 11,
      font: fontBold,
      color: NAVY
    })
    y -= 12
  }

  const metaParts = [
    `${pool.entrantCount} judoka(s)`,
    `tableau ${pool.bracket.size}`,
    partInfo && partInfo.totalParts > 1
      ? `partie ${partInfo.part}/${partInfo.totalParts} · combats ${partInfo.matchFrom}–${partInfo.matchTo}`
      : null
  ].filter(Boolean)

  page.drawText(pdfSafeText(metaParts.join(' · ')), {
    x: MARGIN,
    y: y - 8,
    size: 8,
    font,
    color: MUTED
  })
  y -= 16

  // Ligne de séparation titres / grille
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.75, 0.8, 0.85)
  })
  y -= 8

  return y
}

/**
 * PDF A4 paysage : max 64 combats (1er tour) par page ; au-delà, suite sur page suivante.
 * Titres sans seuils d’âge.
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

  let isFirstDocPage = true

  for (const pool of pools) {
    const slices = bracketPageSlices(pool.bracket)
    const totalParts = slices.length

    for (let partIndex = 0; partIndex < slices.length; partIndex++) {
      const slice = slices[partIndex]!
      const page = doc.addPage([PAGE_W, PAGE_H])
      const showDocTitle = isFirstDocPage
      isFirstDocPage = false

      const partInfo =
        totalParts > 1
          ? {
              part: partIndex + 1,
              totalParts,
              matchFrom: slice.start + 1,
              matchTo: slice.end
            }
          : undefined

      // En-tête (répété sur chaque partie si multipage)
      const gridTop = drawHeaderAndGetGridTop(
        page,
        font,
        fontBold,
        pool,
        showDocTitle,
        partInfo
      )

      const gridBottom = MARGIN
      const availableH = Math.max(60, gridTop - gridBottom)
      const availableW = PAGE_W - MARGIN * 2

      const pageBracket =
        totalParts === 1
          ? pool.bracket
          : sliceBracketTree(pool.bracket, slice.start, slice.end)

      const layout = computeLayout(pageBracket, availableW, availableH)
      drawFullBracket(page, font, fontBold, pageBracket, layout, MARGIN, gridTop)
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
