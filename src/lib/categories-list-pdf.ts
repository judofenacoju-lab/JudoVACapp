import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import type { CategoryAgeRange } from '@shared/types/settings'
import { resolveJudokaCategory } from '@shared/utils/judoka'
import { downloadPdfBytes } from '@/lib/judoka-list-pdf'
import { pdfSafeText } from '@/lib/pdf-winansi-text'

export interface CategoryStatsRow {
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
  const safe = pdfSafeText(text)
  if (font.widthOfTextAtSize(safe, size) <= maxW) return safe
  let t = safe
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxW) {
    t = t.slice(0, -1)
  }
  return `${t}...`
}

/**
 * Effectifs par catégorie d’âge (résolue via date de naissance / catégorie stockée).
 * Inclut toutes les catégories configurées (même à 0) puis les catégories hors liste.
 */
export function buildCategoryStats(
  judokas: Judoka[],
  configuredCategories: CategoryAgeRange[] | string[]
): CategoryStatsRow[] {
  const configuredNames = configuredCategories
    .map((c) => (typeof c === 'string' ? c : c.name).trim())
    .filter(Boolean)

  const map = new Map<string, { total: number; boys: number; girls: number }>()
  for (const name of configuredNames) {
    const key = name.toLowerCase()
    if (!map.has(key)) map.set(key, { total: 0, boys: 0, girls: 0 })
  }

  const displayName = new Map<string, string>()
  for (const name of configuredNames) displayName.set(name.toLowerCase(), name)

  for (const j of judokas) {
    const raw =
      resolveJudokaCategory(j.birthDate, j.category) || j.category?.trim() || 'Sans catégorie'
    const key = raw.toLowerCase()
    if (!displayName.has(key)) displayName.set(key, raw)
    const row = map.get(key) ?? { total: 0, boys: 0, girls: 0 }
    row.total += 1
    if (j.sex === 'F') row.girls += 1
    else row.boys += 1
    map.set(key, row)
  }

  const configuredKeys = new Set(configuredNames.map((n) => n.toLowerCase()))
  const configuredRows = configuredNames.map((name) => {
    const counts = map.get(name.toLowerCase()) ?? { total: 0, boys: 0, girls: 0 }
    return { name, ...counts }
  })

  const extraRows = [...map.entries()]
    .filter(([key]) => !configuredKeys.has(key))
    .map(([key, counts]) => ({ name: displayName.get(key) ?? key, ...counts }))
    .sort((a, b) => {
      if (a.name === 'Sans catégorie') return 1
      if (b.name === 'Sans catégorie') return -1
      return a.name.localeCompare(b.name, 'fr')
    })

  return [...configuredRows, ...extraRows]
}

export interface CategoriesListPdfOptions {
  rows: CategoryStatsRow[]
  filterSummary?: string
  title?: string
}

/**
 * PDF : effectifs judokas par catégorie (total, garçons, filles).
 */
export async function exportCategoriesListPdfBytes(
  options: CategoriesListPdfOptions
): Promise<Uint8Array> {
  const { rows, filterSummary, title = 'Judokas par catégorie — JudoVACapp' } = options
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('JudoVACapp')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const pageW = 595.28
  const pageH = 841.89
  const margin = 40
  const tableW = pageW - margin * 2
  const colCat = tableW - 180
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
    page.drawText(pdfSafeText(title), { x: margin, y: y - 16, size: 16, font: fontBold, color: navy })
    y -= 22
    page.drawText(
      pdfSafeText(
        `Export du ${new Date().toLocaleString('fr-FR')} - ${rows.length} catégorie(s) · ${totalJudokas} judoka(s) (${totalBoys} garçon(s), ${totalGirls} fille(s))`
      ),
      { x: margin, y: y - 10, size: 9, font, color: muted }
    )
    y -= 14
    if (filterSummary) {
      page.drawText(truncate(font, filterSummary, 9, pageW - margin * 2), {
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
      { label: 'Catégorie', x: margin + 6 },
      { label: 'Total', x: margin + colCat },
      { label: 'Garçons', x: margin + colCat + colNum },
      { label: 'Filles', x: margin + colCat + colNum * 2 }
    ]
    for (const h of headers) {
      page.drawText(pdfSafeText(h.label), {
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
    page.drawText(pdfSafeText('Aucune catégorie à exporter.'), {
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

    page.drawText(truncate(font, row.name, 9, colCat - 10), {
      x: margin + 6,
      y: y - rowH + 5,
      size: 9,
      font,
      color: text
    })
    const nums = [String(row.total), String(row.boys), String(row.girls)]
    nums.forEach((val, i) => {
      const x = margin + colCat + colNum * i
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
  page.drawText(pdfSafeText('Total général'), {
    x: margin + 6,
    y: y - rowH + 5,
    size: 9,
    font: fontBold,
    color: navy
  })
  const totals = [String(totalJudokas), String(totalBoys), String(totalGirls)]
  totals.forEach((val, i) => {
    const x = margin + colCat + colNum * i
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

export async function exportAndDownloadCategoriesListPdf(
  judokas: Judoka[],
  configuredCategories: CategoryAgeRange[] | string[]
): Promise<{ filename: string; categoryCount: number }> {
  const rows = buildCategoryStats(judokas, configuredCategories)
  const bytes = await exportCategoriesListPdfBytes({ rows })
  const filename = `liste-categories-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadPdfBytes(bytes, filename)
  return { filename, categoryCount: rows.length }
}
