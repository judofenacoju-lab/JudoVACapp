import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName } from '@shared/utils/judoka'
import { downloadBytes } from './download-blob'
import { pdfSafeText } from './pdf-winansi-text'
import { getActiveBrandName, withBrand } from '@shared/utils/branding'

const MARGIN = 36
const ROW_H = 16
const HEADER_H = 18
const CLUB_H = 20
const TITLE_SIZE = 14
const META_SIZE = 9
const CELL_SIZE = 8

type Col = { key: string; label: string; width: number; value: (j: Judoka, i: number) => string }

/** Colonnes (sans Club : le regroupement est en en-tête de section). */
const COLS: Col[] = [
  { key: 'n', label: 'N°', width: 28, value: (_j, i) => String(i + 1) },
  { key: 'id', label: 'ID', width: 88, value: (j) => j.displayId || '-' },
  { key: 'name', label: 'Nom complet', width: 160, value: (j) => formatJudokaFullName(j) || '-' },
  { key: 'sex', label: 'Sexe', width: 36, value: (j) => j.sex || '-' },
  { key: 'age', label: 'Age', width: 32, value: (j) => (j.age != null ? String(j.age) : '-') },
  { key: 'grade', label: 'Grade', width: 60, value: (j) => j.grade || '-' },
  { key: 'cat', label: 'Categorie', width: 80, value: (j) => j.category || '-' },
  {
    key: 'weight',
    label: 'Poids',
    width: 44,
    value: (j) => (j.weightKg != null ? `${j.weightKg}` : '-')
  },
  { key: 'license', label: 'Licence', width: 78, value: (j) => j.licenseNumber || '-' },
  { key: 'user', label: 'Utilisateur', width: 80, value: (j) => j.createdBy || '-' }
]

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

/** Regroupe et trie les judokas par club (alphabétique), puis par nom. */
export function groupJudokasByClub(judokas: Judoka[]): Array<{ club: string; items: Judoka[] }> {
  const map = new Map<string, Judoka[]>()
  for (const j of judokas) {
    const name = j.club.trim() || 'Sans club'
    const list = map.get(name) ?? []
    list.push(j)
    map.set(name, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
  }
  return [...map.entries()]
    .map(([club, items]) => ({ club, items }))
    .sort((a, b) => {
      if (a.club === 'Sans club') return 1
      if (b.club === 'Sans club') return -1
      return a.club.localeCompare(b.club, 'fr')
    })
}

export interface JudokaListPdfOptions {
  judokas: Judoka[]
  /** Libellé des filtres actifs (affiché en en-tête). */
  filterSummary?: string
  title?: string
  /** Mode d’export (libellé fichier / titre). */
  mode?: 'registered' | 'weighed'
}

/**
 * PDF liste des judokas classés par club.
 */
export async function exportJudokaListPdfBytes(options: JudokaListPdfOptions): Promise<Uint8Array> {
  const mode = options.mode ?? 'registered'
  const defaultTitle =
    mode === 'weighed'
      ? withBrand('Liste des judokas pesés (par club) - JudoVACapp')
      : withBrand('Liste des judokas enregistrés (par club) - JudoVACapp')
  const { judokas, filterSummary, title = defaultTitle } = options
  const groups = groupJudokasByClub(judokas)

  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor(getActiveBrandName())
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Paysage A4
  const pageW = 841.89
  const pageH = 595.28
  const tableW = COLS.reduce((s, c) => s + c.width, 0)
  const tableX = Math.max(MARGIN, (pageW - tableW) / 2)

  const navy = rgb(0.043, 0.122, 0.227)
  const headerBg = rgb(0.043, 0.122, 0.227)
  const clubBg = rgb(0.85, 0.12, 0.15)
  const zebra = rgb(0.94, 0.96, 0.98)
  const line = rgb(0.78, 0.82, 0.86)
  const text = rgb(0.08, 0.12, 0.18)

  let page = pdf.addPage([pageW, pageH])
  let y = pageH - MARGIN

  function drawHeaderBlock(isContinuation = false): void {
    page.drawText(pdfSafeText(isContinuation ? `${title} (suite)` : title), {
      x: MARGIN,
      y: y - TITLE_SIZE,
      size: isContinuation ? 11 : TITLE_SIZE,
      font: fontBold,
      color: navy
    })
    y -= (isContinuation ? 11 : TITLE_SIZE) + 6
    if (!isContinuation) {
      const dateLine = pdfSafeText(
        `Export du ${new Date().toLocaleString('fr-FR')} - ${judokas.length} judoka(s) · ${groups.length} club(s)`
      )
      page.drawText(dateLine, { x: MARGIN, y: y - META_SIZE, size: META_SIZE, font, color: text })
      y -= META_SIZE + 4
      if (filterSummary) {
        page.drawText(truncate(font, `Perimetre : ${filterSummary}`, META_SIZE, pageW - MARGIN * 2), {
          x: MARGIN,
          y: y - META_SIZE,
          size: META_SIZE,
          font,
          color: text
        })
        y -= META_SIZE + 8
      } else {
        y -= 4
      }
    } else {
      y -= 4
    }
  }

  function drawTableHeader(): void {
    page.drawRectangle({
      x: tableX,
      y: y - HEADER_H,
      width: tableW,
      height: HEADER_H,
      color: headerBg
    })
    let x = tableX
    for (const col of COLS) {
      page.drawText(pdfSafeText(col.label), {
        x: x + 3,
        y: y - HEADER_H + 5,
        size: CELL_SIZE,
        font: fontBold,
        color: rgb(1, 1, 1)
      })
      x += col.width
    }
    y -= HEADER_H
  }

  function newPage(continuation = true): void {
    page = pdf.addPage([pageW, pageH])
    y = pageH - MARGIN
    drawHeaderBlock(continuation)
    drawTableHeader()
  }

  function ensureSpace(needed: number): void {
    if (y - needed >= MARGIN) return
    newPage(true)
  }

  function drawClubHeader(club: string, count: number): void {
    ensureSpace(CLUB_H + ROW_H + 4)
    page.drawRectangle({
      x: tableX,
      y: y - CLUB_H,
      width: tableW,
      height: CLUB_H,
      color: clubBg
    })
    page.drawText(
      truncate(fontBold, pdfSafeText(`${club}  (${count})`), 10, tableW - 12),
      {
        x: tableX + 6,
        y: y - CLUB_H + 6,
        size: 10,
        font: fontBold,
        color: rgb(1, 1, 1)
      }
    )
    y -= CLUB_H
  }

  function drawRow(j: Judoka, indexInClub: number, zebraOn: boolean): void {
    ensureSpace(ROW_H)
    if (zebraOn) {
      page.drawRectangle({
        x: tableX,
        y: y - ROW_H,
        width: tableW,
        height: ROW_H,
        color: zebra
      })
    }
    page.drawRectangle({
      x: tableX,
      y: y - ROW_H,
      width: tableW,
      height: ROW_H,
      borderColor: line,
      borderWidth: 0.4
    })
    let x = tableX
    for (const col of COLS) {
      const cell = truncate(font, col.value(j, indexInClub), CELL_SIZE, col.width - 6)
      page.drawText(cell, {
        x: x + 3,
        y: y - ROW_H + 4,
        size: CELL_SIZE,
        font,
        color: text
      })
      x += col.width
    }
    y -= ROW_H
  }

  drawHeaderBlock(false)
  drawTableHeader()

  if (judokas.length === 0) {
    page.drawText(pdfSafeText('Aucun judoka pour les filtres selectionnes.'), {
      x: tableX,
      y: y - 24,
      size: 11,
      font,
      color: text
    })
    return pdf.save()
  }

  for (const group of groups) {
    drawClubHeader(group.club, group.items.length)
    group.items.forEach((j, i) => {
      drawRow(j, i, i % 2 === 1)
    })
  }

  return pdf.save()
}

export async function exportAndDownloadJudokaListPdf(
  judokas: Judoka[],
  options?: {
    filterSummary?: string
    mode?: 'registered' | 'weighed'
  }
): Promise<{ filename: string; judokaCount: number; clubCount: number }> {
  const mode = options?.mode ?? 'registered'
  const groups = groupJudokasByClub(judokas)
  const bytes = await exportJudokaListPdfBytes({
    judokas,
    filterSummary: options?.filterSummary,
    mode
  })
  const filename =
    mode === 'weighed'
      ? `liste-judokas-peses-par-club-${new Date().toISOString().slice(0, 10)}.pdf`
      : `liste-judokas-enregistres-par-club-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadPdfBytes(bytes, filename)
  return { filename, judokaCount: judokas.length, clubCount: groups.length }
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  downloadBytes(bytes, filename, 'application/pdf')
}
