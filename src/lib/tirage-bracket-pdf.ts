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
const FOOTER_PAD = 14
const HEADER_GRID_GAP = 8

const NAVY = rgb(0.043, 0.122, 0.227)
const RED = rgb(0.784, 0.063, 0.18)
const LINE = rgb(0.043, 0.122, 0.227)
const MUTED = rgb(0.35, 0.4, 0.45)
const WHITE = rgb(1, 1, 1)

const EMPTY_SLOT = '...'

/** Cases plus larges / hautes pour noms complets (prénom + nom) visibles. */
const BOX_H = 46
const BOX_GAP = 8
const BOX_W = 230
const LATER_W = 200
const CONNECTOR_W = 36
const WINNER_TAIL = 70

type PdfFont = Awaited<ReturnType<PDFDocument['embedFont']>>

function wrapLines(font: PdfFont, text: string, size: number, maxW: number, maxLines: number): string[] {
  const safe = pdfSafeText(text)
  if (!safe) return []
  if (font.widthOfTextAtSize(safe, size) <= maxW) return [safe]

  const words = safe.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  const pushCurrent = () => {
    if (current) lines.push(current)
    current = ''
  }

  for (const word of words) {
    const trial = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) <= maxW) {
      current = trial
      continue
    }
    if (current) {
      pushCurrent()
      if (lines.length >= maxLines) break
    }
    if (font.widthOfTextAtSize(word, size) <= maxW) {
      current = word
    } else {
      // Mot trop long : couper sans « … » pour garder le maximum de caractères
      let chunk = ''
      for (const ch of word) {
        const next = chunk + ch
        if (font.widthOfTextAtSize(next, size) > maxW) break
        chunk = next
      }
      lines.push(chunk || word.slice(0, 1))
      current = ''
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)

  return lines.slice(0, maxLines)
}

function slotName(fighter: TirageFighter | null | undefined): string {
  return fighter ? fighter.name : EMPTY_SLOT
}

/** Case entièrement dans la bande grille. */
function fullyVisible(cy: number, halfH: number, top: number, bottom: number): boolean {
  return cy + halfH <= top + 0.5 && cy - halfH >= bottom - 0.5
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
  visibleBottom: number
): void {
  if (!fullyVisible(cy, boxH / 2, visibleTop, visibleBottom)) return

  const y0 = cy - boxH / 2
  const labelW = 46
  const nameW = boxW - labelW
  const nameSize = 7
  const metaSize = 5.5
  const labelSize = 6.5
  const textMaxW = nameW - 8

  page.drawRectangle({
    x,
    y: y0,
    width: boxW,
    height: boxH,
    borderColor: NAVY,
    borderWidth: 0.9,
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
    thickness: 0.6,
    color: NAVY
  })

  const drawSlot = (fighter: TirageFighter | null, slotTop: number, slotBottom: number) => {
    const mid = (slotTop + slotBottom) / 2
    if (!fighter) {
      page.drawText(EMPTY_SLOT, {
        x: x + 4,
        y: mid - nameSize / 3,
        size: nameSize,
        font: fontBold,
        color: NAVY
      })
      return
    }

    const nameLines = wrapLines(fontBold, slotName(fighter), nameSize, textMaxW, 2)
    const meta = pdfSafeText(formatFighterMeta(fighter))
    const metaFits = font.widthOfTextAtSize(meta, metaSize) <= textMaxW
    const metaLine = metaFits ? meta : wrapLines(font, meta, metaSize, textMaxW, 1)[0] ?? meta

    const lineGap = 1.5
    const blockH =
      nameLines.length * nameSize +
      (nameLines.length > 1 ? (nameLines.length - 1) * lineGap : 0) +
      2 +
      metaSize
    let y = mid + blockH / 2 - nameSize

    for (const line of nameLines) {
      page.drawText(line, {
        x: x + 4,
        y,
        size: nameSize,
        font: fontBold,
        color: NAVY
      })
      y -= nameSize + lineGap
    }
    y -= 1
    page.drawText(metaLine, {
      x: x + 4,
      y,
      size: metaSize,
      font,
      color: MUTED
    })
  }

  drawSlot(match.top.fighter, cy + boxH / 2, cy)
  drawSlot(match.bottom.fighter, cy, cy - boxH / 2)

  const label = pdfSafeText(match.label)
  const lw = fontBold.widthOfTextAtSize(label, labelSize)
  page.drawText(label, {
    x: x + nameW + Math.max(2, (labelW - lw) / 2),
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
  while (needed() > maxWidth && (boxW > 160 || laterW > 140)) {
    boxW = Math.max(160, boxW - 6)
    laterW = Math.max(140, laterW - 6)
    connectorW = Math.max(26, connectorW - 1)
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
      if (fullyVisible(cy, 12, visibleTop, visibleBottom)) {
        const x0 = nextX
        page.drawLine({
          start: { x: x0, y: cy },
          end: { x: x0 + 28, y: cy },
          thickness: 1,
          color: LINE
        })
        page.drawText(pdfSafeText('Vainqueur'), {
          x: x0 + 32,
          y: cy - 2.5,
          size: 8,
          font: fontBold,
          color: RED
        })
      }
    }
  }

  return colH
}

function measurePoolHeaderHeight(opts: {
  showDocTitle: boolean
  showCategoryTitle: boolean
  hasFilters: boolean
}): number {
  let h = HEADER_GRID_GAP
  if (opts.showDocTitle) h += 26
  else h += 16 // place pour n° de page / suite
  h += 16 // trait
  if (opts.showCategoryTitle) {
    h += 20
    if (opts.hasFilters) h += 14
    h += 18 // meta judokas
  } else {
    h += 14 // ligne « suite » courte
  }
  return h
}

/** En-tête : titre doc + catégorie uniquement quand demandé (pas de répétition). */
function drawPageHeader(
  page: ReturnType<PDFDocument['addPage']>,
  font: PdfFont,
  fontBold: PdfFont,
  pool: TiragePool,
  meta: { filtersLabel?: string } | undefined,
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

  y -= showDocTitle ? 26 : 16

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: NAVY
  })
  y -= 16

  if (showCategoryTitle) {
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
    y -= 4

    if (meta?.filtersLabel) {
      page.drawText(pdfSafeText(meta.filtersLabel), {
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
 * PDF A4 paysage : titres non répétés ; noms complets visibles ; sans pied de page.
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

  const contentBottom = FOOTER_PAD
  const hasFilters = Boolean(meta?.filtersLabel)
  let isFirstDocPage = true

  for (const pool of pools) {
    const n0 = pool.bracket.rounds[0]?.length ?? 0
    const colH = n0 > 0 ? n0 * (BOX_H + BOX_GAP) - BOX_GAP : 0

    // Capacités différentes : 1ʳᵉ page de la catégorie (titre) vs pages suite
    const firstHeaderH = measurePoolHeaderHeight({
      showDocTitle: isFirstDocPage,
      showCategoryTitle: true,
      hasFilters
    })
    const contHeaderH = measurePoolHeaderHeight({
      showDocTitle: false,
      showCategoryTitle: false,
      hasFilters: false
    })
    const firstAvail = Math.max(80, PAGE_H - MARGIN - firstHeaderH - contentBottom)
    const contAvail = Math.max(80, PAGE_H - MARGIN - contHeaderH - contentBottom)

    let pageCount = 1
    if (colH > firstAvail) {
      pageCount = 1 + Math.ceil((colH - firstAvail) / contAvail)
    }

    let yConsumed = 0
    for (let p = 0; p < pageCount; p++) {
      const page = doc.addPage([PAGE_W, PAGE_H])
      const showDocTitle = isFirstDocPage
      const showCategoryTitle = p === 0
      isFirstDocPage = false

      const headerH = measurePoolHeaderHeight({
        showDocTitle,
        showCategoryTitle,
        hasFilters: showCategoryTitle && hasFilters
      })
      const contentTop = PAGE_H - MARGIN - headerH
      const availableH = Math.max(80, contentTop - contentBottom)
      const yShift = yConsumed

      drawBracketSlice(
        page,
        font,
        fontBold,
        pool.bracket,
        MARGIN,
        contentTop,
        yShift,
        contentTop,
        contentBottom,
        PAGE_W - MARGIN * 2
      )

      // Masques : titres au-dessus de la grille
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
        meta,
        p,
        pageCount,
        showDocTitle,
        showCategoryTitle
      )

      page.drawLine({
        start: { x: MARGIN, y: contentTop + 2 },
        end: { x: PAGE_W - MARGIN, y: contentTop + 2 },
        thickness: 0.5,
        color: rgb(0.75, 0.8, 0.85)
      })

      yConsumed += availableH
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
