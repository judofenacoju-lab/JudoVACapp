import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName } from '@shared/utils/judoka'

const MARGIN = 36
const ROW_H = 16
const HEADER_H = 18
const TITLE_SIZE = 14
const META_SIZE = 9
const CELL_SIZE = 8

type Col = { key: string; label: string; width: number; value: (j: Judoka, i: number) => string }

const COLS: Col[] = [
  { key: 'n', label: 'N°', width: 28, value: (_j, i) => String(i + 1) },
  { key: 'id', label: 'ID', width: 78, value: (j) => j.displayId || '—' },
  { key: 'name', label: 'Nom complet', width: 140, value: (j) => formatJudokaFullName(j) || '—' },
  { key: 'sex', label: 'Sexe', width: 32, value: (j) => j.sex || '—' },
  { key: 'age', label: 'Âge', width: 28, value: (j) => (j.age != null ? String(j.age) : '—') },
  { key: 'club', label: 'Club', width: 90, value: (j) => j.club || '—' },
  { key: 'grade', label: 'Grade', width: 55, value: (j) => j.grade || '—' },
  { key: 'cat', label: 'Catégorie', width: 70, value: (j) => j.category || '—' },
  {
    key: 'weight',
    label: 'Poids',
    width: 40,
    value: (j) => (j.weightKg != null ? `${j.weightKg}` : '—')
  },
  { key: 'license', label: 'Licence', width: 70, value: (j) => j.licenseNumber || '—' },
  { key: 'user', label: 'Utilisateur', width: 70, value: (j) => j.createdBy || '—' }
]

function truncate(font: Awaited<ReturnType<PDFDocument['embedFont']>>, text: string, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) {
    t = t.slice(0, -1)
  }
  return `${t}…`
}

export interface JudokaListPdfOptions {
  judokas: Judoka[]
  /** Libellé des filtres actifs (affiché en en-tête). */
  filterSummary?: string
  title?: string
}

/**
 * PDF tableau de la liste des judokas (respecte le filtre courant).
 */
export async function exportJudokaListPdfBytes(options: JudokaListPdfOptions): Promise<Uint8Array> {
  const { judokas, filterSummary, title = 'Liste des judokas — JudoVACapp' } = options
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('JudoVACapp')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Paysage A4
  const pageW = 841.89
  const pageH = 595.28
  const tableW = COLS.reduce((s, c) => s + c.width, 0)
  const tableX = Math.max(MARGIN, (pageW - tableW) / 2)

  const navy = rgb(0.043, 0.122, 0.227)
  const headerBg = rgb(0.043, 0.122, 0.227)
  const zebra = rgb(0.94, 0.96, 0.98)
  const line = rgb(0.78, 0.82, 0.86)
  const text = rgb(0.08, 0.12, 0.18)

  let page = pdf.addPage([pageW, pageH])
  let y = pageH - MARGIN

  function drawHeaderBlock(): void {
    page.drawText(title, { x: MARGIN, y: y - TITLE_SIZE, size: TITLE_SIZE, font: fontBold, color: navy })
    y -= TITLE_SIZE + 6
    const dateLine = `Export du ${new Date().toLocaleString('fr-FR')} — ${judokas.length} judoka(s)`
    page.drawText(dateLine, { x: MARGIN, y: y - META_SIZE, size: META_SIZE, font, color: text })
    y -= META_SIZE + 4
    if (filterSummary) {
      page.drawText(
        truncate(font, `Filtres : ${filterSummary}`, META_SIZE, pageW - MARGIN * 2),
        { x: MARGIN, y: y - META_SIZE, size: META_SIZE, font, color: text }
      )
      y -= META_SIZE + 8
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
      page.drawText(col.label, {
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

  function newPage(): void {
    page = pdf.addPage([pageW, pageH])
    y = pageH - MARGIN
    drawHeaderBlock()
    drawTableHeader()
  }

  drawHeaderBlock()
  drawTableHeader()

  if (judokas.length === 0) {
    page.drawText('Aucun judoka pour les filtres sélectionnés.', {
      x: tableX,
      y: y - 24,
      size: 11,
      font,
      color: text
    })
    return pdf.save()
  }

  judokas.forEach((j, index) => {
    if (y - ROW_H < MARGIN) newPage()

    if (index % 2 === 1) {
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
      const raw = col.value(j, index)
      const cell = truncate(font, raw, CELL_SIZE, col.width - 6)
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
  })

  return pdf.save()
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
