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
const BLUE = rgb(0.114, 0.306, 0.847)
const LINE = rgb(0.043, 0.122, 0.227)
const MUTED = rgb(0.35, 0.4, 0.45)
const WHITE = rgb(1, 1, 1)

const EMPTY_SLOT = '...'

/**
 * Max de combats du 1er tour par page PDF.
 * Limité pour garder des cases lisibles (nom + club + âge) ; le surplus passe à la page suivante.
 */
const MAX_FIRST_ROUND_MATCHES_PER_PAGE = 12
/** Hauteur de case cible pour lisibilité (nom + club + âge). */
const READABLE_BOX_H = 40
const READABLE_GAP = 4
/** Largeur 1er tour (−25 % vs base 188). */
const READABLE_BOX_W = Math.round(188 * 0.75)
/** Largeur tours suivants / 2ᵉ combats (+25 % vs base 110). */
const READABLE_LATER_W = Math.round(110 * 1.25)

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
    repechage: [],
    bronze: [],
    size: Math.max(r0Count * 2, 2),
    entrantCount: bracket.entrantCount
  }
}

/** Découpe un tableau en parties de ≤ N combats au 1er tour (lisibilité). */
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
 * Layout à taille lisible fixe (nom + club + âge).
 * La pagination garantit que n0 tient dans maxHeight.
 */
function computeLayout(bracket: BracketTree, maxWidth: number, maxHeight: number): BracketLayout {
  const n0 = Math.max(1, bracket.rounds[0]?.length ?? 1)
  const laterRounds = Math.max(0, bracket.rounds.length - 1)

  let boxH = READABLE_BOX_H
  let gap = READABLE_GAP
  let boxW = READABLE_BOX_W
  let laterW = READABLE_LATER_W
  let connectorW = 22
  let winnerTail = 56

  const widthNeeded = () => boxW + laterRounds * (laterW + connectorW) + winnerTail
  const heightNeeded = () => n0 * (boxH + gap) - gap

  // Largeur uniquement (ne pas réduire la hauteur sous le seuil lisible)
  let guard = 0
  while (widthNeeded() > maxWidth && guard < 80) {
    guard += 1
    if (boxW > 110) boxW -= 2
    else if (laterW > 90) laterW -= 2
    else if (connectorW > 14) connectorW -= 1
    else if (winnerTail > 40) winnerTail -= 2
    else break
  }

  // Si la page est un peu juste, compresser très légèrement sans passer sous 34
  let colH = heightNeeded()
  if (colH > maxHeight && maxHeight > 40) {
    const scale = (maxHeight - 1) / colH
    const nextH = Math.max(34, boxH * scale)
    const nextGap = Math.max(2.5, gap * scale)
    boxH = nextH
    gap = nextGap
    colH = n0 * (boxH + gap) - gap
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
  // Bandeau combat un peu plus étroit pour laisser place au club / âge
  const labelW = Math.min(36, Math.max(28, boxW * 0.18))
  const nameW = boxW - labelW
  const compact = boxH < 32
  const nameSize = compact ? 6 : boxH >= 38 ? 8 : 7
  // Meta comme sur Tirage (club · âge), un peu plus grand
  const metaSize = compact ? 5.5 : 6.5
  const labelSize = compact ? 5 : 6
  const textMaxW = Math.max(24, nameW - 5)

  page.drawRectangle({
    x,
    y: y0,
    width: boxW,
    height: boxH,
    borderColor: NAVY,
    borderWidth: 0.7,
    color: WHITE
  })
  // BLEU en bas
  page.drawRectangle({
    x: x + 0.5,
    y: y0 + 0.5,
    width: nameW - 0.5,
    height: boxH / 2 - 0.7,
    color: BLUE
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

  const drawSlot = (
    fighter: TirageFighter | null,
    slotMid: number,
    color: typeof NAVY | typeof WHITE
  ) => {
    if (!fighter) {
      page.drawText(EMPTY_SLOT, {
        x: x + 3,
        y: slotMid - nameSize / 3,
        size: nameSize,
        font: fontBold,
        color
      })
      return
    }

    const nameLines = wrapLines(fontBold, fighter.name, nameSize, textMaxW, 1)
    const metaLine = wrapLines(font, formatFighterMeta(fighter), metaSize, textMaxW, 1)[0]

    const lineGap = 1.2
    const blockH =
      nameLines.length * nameSize +
      Math.max(0, nameLines.length - 1) * lineGap +
      (metaLine ? metaSize + 2 : 0)
    let y = slotMid + blockH / 2 - nameSize

    for (const line of nameLines) {
      page.drawText(line, {
        x: x + 3,
        y,
        size: nameSize,
        font: fontBold,
        color
      })
      y -= nameSize + lineGap
    }
    if (metaLine) {
      page.drawText(metaLine, {
        x: x + 3,
        y: y - 0.5,
        size: metaSize,
        font,
        color: color === WHITE ? rgb(0.85, 0.9, 1) : MUTED
      })
    }
  }

  drawSlot(match.top.fighter, cy + boxH / 4, NAVY)
  drawSlot(match.bottom.fighter, cy - boxH / 4, WHITE)

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
      const destCount = Math.ceil(count / 2)
      for (let p = 0; p < destCount; p++) {
        const i0 = p * 2
        const i1 = p * 2 + 1
        const topCy = matchCenterY(i0, count)
        const x0 = nextX
        const x1 = nextX + connectorW * 0.42
        const x2 = nextX + connectorW
        if (i1 < count) {
          const botCy = matchCenterY(i1, count)
          const midCy = (topCy + botCy) / 2
          page.drawLine({ start: { x: x0, y: topCy }, end: { x: x1, y: topCy }, thickness: 0.9, color: LINE })
          page.drawLine({ start: { x: x0, y: botCy }, end: { x: x1, y: botCy }, thickness: 0.9, color: LINE })
          page.drawLine({ start: { x: x1, y: topCy }, end: { x: x1, y: botCy }, thickness: 0.9, color: LINE })
          page.drawLine({ start: { x: x1, y: midCy }, end: { x: x2, y: midCy }, thickness: 0.9, color: LINE })
        } else {
          page.drawLine({ start: { x: x0, y: topCy }, end: { x: x2, y: topCy }, thickness: 0.9, color: LINE })
        }
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
      page.drawText(pdfSafeText('Finale Or'), {
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
 * PDF A4 paysage : cases lisibles (nom + club + âge) ; surplus sur page suivante.
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

      if (partIndex === slices.length - 1) {
        drawRepechageBronzePages(doc, font, fontBold, pool)
      }
    }
  }

  return doc.save()
}

function drawRepechageBronzePages(
  doc: PDFDocument,
  font: PdfFont,
  fontBold: PdfFont,
  pool: TiragePool
): void {
  const repechage = pool.bracket.repechage ?? []
  const bronze = pool.bracket.bronze ?? []
  if (repechage.length === 0 && bronze.length === 0) return

  const page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  page.drawText(pdfSafeText('JudoVACapp - Repechage / Bronze'), {
    x: MARGIN,
    y: y - 12,
    size: 14,
    font: fontBold,
    color: NAVY
  })
  y -= 28
  const cat = pdfSafeText(
    `${pool.sexLabel} · ${formatTirageCategoryName(pool.category)}${
      pool.weightLabel?.trim() ? ` · ${pool.weightLabel.trim()}` : ''
    }`
  )
  page.drawText(cat, { x: MARGIN, y: y - 8, size: 11, font: fontBold, color: NAVY })
  y -= 22
  page.drawText(
    pdfSafeText('Perdants des quarts entre eux, puis gagnants contre les perdants de demi-finale.'),
    { x: MARGIN, y: y - 8, size: 8, font, color: MUTED }
  )
  y -= 26

  const boxW = 190
  const boxH = 40
  const gapY = 16
  const linkW = 28
  const pairs = Math.max(repechage.length, bronze.length)
  page.drawText(pdfSafeText('Repechage'), {
    x: MARGIN,
    y: y - 8,
    size: 9,
    font: fontBold,
    color: RED
  })
  page.drawText(pdfSafeText('Finale de Bronze'), {
    x: MARGIN + boxW + linkW,
    y: y - 8,
    size: 9,
    font: fontBold,
    color: RED
  })
  y -= 16
  for (let i = 0; i < pairs; i++) {
    const cy = y - boxH / 2
    if (repechage[i]) {
      drawMatchCard(page, font, fontBold, repechage[i]!, MARGIN, cy, boxW, boxH)
    }
    if (bronze[i]) {
      drawMatchCard(page, font, fontBold, bronze[i]!, MARGIN + boxW + linkW, cy, boxW, boxH)
    }
    page.drawLine({
      start: { x: MARGIN + boxW, y: cy },
      end: { x: MARGIN + boxW + linkW, y: cy },
      thickness: 0.9,
      color: LINE
    })
    y -= boxH + gapY
  }
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
