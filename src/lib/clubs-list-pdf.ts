import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import { downloadPdfBytes } from '@/lib/judoka-list-pdf'

export interface ClubStatsRow {
  name: string
  total: number
  boys: number
  girls: number
}

function truncate(
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  text: string,
  size: number,
  maxW: number
): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) {
    t = t.slice(0, -1)
  }
  return `${t}…`
}

/** Regroupe les judokas par club avec effectifs garçons / filles. */
export function buildClubStats(judokas: Judoka[]): ClubStatsRow[] {
  const map = new Map<string, { total: number; boys: number; girls: number }>()
  for (const j of judokas) {
    const name = j.club.trim() || 'Sans club'
    const row = map.get(name) ?? { total: 0, boys: 0, girls: 0 }
    row.total += 1
    if (j.sex === 'F') row.girls += 1
    else row.boys += 1
    map.set(name, row)
  }
  return [...map.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => {
      if (a.name === 'Sans club') return 1
      if (b.name === 'Sans club') return -1
      return a.name.localeCompare(b.name, 'fr')
    })
}

export interface ClubsListPdfOptions {
  rows: ClubStatsRow[]
  filterSummary?: string
  title?: string
}

/**
 * PDF : clubs enregistrés avec effectifs total, garçons et filles.
 */
export async function exportClubsListPdfBytes(options: ClubsListPdfOptions): Promise<Uint8Array> {
  const { rows, filterSummary, title = 'Clubs enregistrés — JudoVACapp' } = options
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('JudoVACapp')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const pageW = 595.28
  const pageH = 841.89
  const margin = 40
  const tableW = pageW - margin * 2
  const colClub = tableW - 180
  const colNum = 60
  const rowH = 18
  const headerH = 20

  const navy = rgb(0.043, 0.122, 0.227)
  const headerBg = rgb(0.043, 0.122, 0.227)
  const zebra = rgb(0.94, 0.96, 0.98)
  const line = rgb(0.78, 0.82, 0.86)
  const text = rgb(0.08, 0.12, 0.18)
  const muted = rgb(0.4, 0.45, 0.5)

  const totalJudokas = rows.reduce((s, r) => s + r.total, 0)
  const totalBoys = rows.reduce((s, r) => s + r.boys, 0)
  const totalGirls = rows.reduce((s, r) => s + r.girls, 0)

  let page = pdf.addPage([pageW, pageH])
  let y = pageH - margin

  function drawPageHeader(): void {
    page.drawText(title, { x: margin, y: y - 16, size: 16, font: fontBold, color: navy })
    y -= 22
    page.drawText(
      `Export du ${new Date().toLocaleString('fr-FR')} — ${rows.length} club(s) · ${totalJudokas} judoka(s) (${totalBoys} garçon(s), ${totalGirls} fille(s))`,
      { x: margin, y: y - 10, size: 9, font, color: muted }
    )
    y -= 14
    if (filterSummary) {
      page.drawText(truncate(font, `Périmètre : ${filterSummary}`, 9, pageW - margin * 2), {
        x: margin,
        y: y - 10,
        size: 9,
        font,
        color: text
      })
      y -= 16
    } else {
      y -= 6
    }
  }

  function drawTableHeader(): void {
    page.drawRectangle({
      x: margin,
      y: y - headerH,
      width: tableW,
      height: headerH,
      color: headerBg
    })
    const headers = [
      { label: 'Club', x: margin + 6, w: colClub },
      { label: 'Total', x: margin + colClub, w: colNum },
      { label: 'Garçons', x: margin + colClub + colNum, w: colNum },
      { label: 'Filles', x: margin + colClub + colNum * 2, w: colNum }
    ]
    for (const h of headers) {
      page.drawText(h.label, {
        x: h.x,
        y: y - headerH + 6,
        size: 9,
        font: fontBold,
        color: rgb(1, 1, 1)
      })
    }
    y -= headerH
  }

  function newPage(): void {
    page = pdf.addPage([pageW, pageH])
    y = pageH - margin
    drawTableHeader()
  }

  drawPageHeader()
  drawTableHeader()

  if (rows.length === 0) {
    page.drawText('Aucun club enregistré pour le périmètre sélectionné.', {
      x: margin,
      y: y - 24,
      size: 11,
      font,
      color: text
    })
    return pdf.save()
  }

  rows.forEach((row, index) => {
    if (y - rowH < margin) newPage()

    if (index % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: y - rowH,
        width: tableW,
        height: rowH,
        color: zebra
      })
    }
    page.drawRectangle({
      x: margin,
      y: y - rowH,
      width: tableW,
      height: rowH,
      borderColor: line,
      borderWidth: 0.4
    })

    page.drawText(truncate(font, row.name, 9, colClub - 10), {
      x: margin + 6,
      y: y - rowH + 5,
      size: 9,
      font,
      color: text
    })
    const nums = [String(row.total), String(row.boys), String(row.girls)]
    nums.forEach((val, i) => {
      const x = margin + colClub + colNum * i
      const w = font.widthOfTextAtSize(val, 9)
      page.drawText(val, {
        x: x + colNum - w - 6,
        y: y - rowH + 5,
        size: 9,
        font: fontBold,
        color: navy
      })
    })
    y -= rowH
  })

  if (y - rowH < margin) newPage()
  y -= 8
  page.drawRectangle({
    x: margin,
    y: y - rowH,
    width: tableW,
    height: rowH,
    color: rgb(0.88, 0.9, 0.94)
  })
  page.drawText('Total général', {
    x: margin + 6,
    y: y - rowH + 5,
    size: 9,
    font: fontBold,
    color: navy
  })
  const totals = [String(totalJudokas), String(totalBoys), String(totalGirls)]
  totals.forEach((val, i) => {
    const x = margin + colClub + colNum * i
    const w = font.widthOfTextAtSize(val, 9)
    page.drawText(val, {
      x: x + colNum - w - 6,
      y: y - rowH + 5,
      size: 9,
      font: fontBold,
      color: navy
    })
  })

  return pdf.save()
}

export async function exportAndDownloadClubsListPdf(
  judokas: Judoka[],
  filterSummary?: string
): Promise<{ filename: string; clubCount: number }> {
  const rows = buildClubStats(judokas)
  const bytes = await exportClubsListPdfBytes({ rows, filterSummary })
  const filename = `liste-clubs-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadPdfBytes(bytes, filename)
  return { filename, clubCount: rows.length }
}
