import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import {
  formatJudokaFullName,
  hasRecordedWeight,
  resolveJudokaCategory
} from '@shared/utils/judoka'
import { downloadPdfBytes } from '@/lib/judoka-list-pdf'
import { pdfSafeText } from '@/lib/pdf-winansi-text'

const MARGIN = 36
const ROW_H = 16
const HEADER_H = 18
const TITLE_SIZE = 14
const META_SIZE = 9
const CELL_SIZE = 8
const SECTION_H = 22
const WEIGHT_BLOCK_H = 15
const WEIGHT_BLOCK_GAP = 8

type WeightGroup = { weight: number; label: string; judokas: Judoka[] }

type Col = { key: string; label: string; width: number; value: (j: Judoka, i: number) => string }

const COLS: Col[] = [
  { key: 'n', label: pdfSafeText('N°'), width: 28, value: (_j, i) => String(i + 1) },
  {
    key: 'name',
    label: 'Nom complet',
    width: 180,
    value: (j) => pdfSafeText(formatJudokaFullName(j) || '-')
  },
  { key: 'age', label: pdfSafeText('Âge'), width: 28, value: (j) => (j.age != null ? String(j.age) : '-') },
  {
    key: 'weight',
    label: 'Poids (kg)',
    width: 55,
    value: (j) => (j.weightKg != null ? String(j.weightKg) : '-')
  },
  { key: 'club', label: 'Club', width: 100, value: (j) => pdfSafeText(j.club || '-') },
  { key: 'grade', label: 'Grade', width: 50, value: (j) => pdfSafeText(j.grade || '-') },
  {
    key: 'cat',
    label: pdfSafeText('Catégorie'),
    width: 70,
    value: (j) => pdfSafeText(resolveJudokaCategory(j.birthDate, j.category) || '-')
  },
  { key: 'license', label: 'Licence', width: 70, value: (j) => pdfSafeText(j.licenseNumber || '-') }
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

function normalizeWeightKey(weightKg: unknown): number {
  if (weightKg === null || weightKg === undefined) return 0
  const raw = typeof weightKg === 'string' ? weightKg.trim().replace(',', '.') : weightKg
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

function formatWeightLabel(weightKg: unknown): string {
  const key = normalizeWeightKey(weightKg)
  if (key === 0 && weightKg !== 0 && weightKg !== '0') return '—'
  return Number.isInteger(key) ? String(key) : key.toFixed(1).replace('.', ',')
}

/** Blocs de poids identiques (ordre d'apparition des groupes). */
export function groupSectionByIdenticalWeight(list: Judoka[]): WeightGroup[] {
  const groups = new Map<number, Judoka[]>()
  const keyOrder: number[] = []

  for (const j of list) {
    const key = normalizeWeightKey(j.weightKg)
    if (!groups.has(key)) {
      groups.set(key, [])
      keyOrder.push(key)
    }
    groups.get(key)!.push(j)
  }

  const out: WeightGroup[] = []
  for (const key of keyOrder) {
    const judokas = groups.get(key)!
    judokas.sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
    const label = `${formatWeightLabel(judokas[0]!.weightKg)} kg`
    out.push({ weight: key, label, judokas })
  }
  return out
}

function sortSectionByIdenticalWeight(list: Judoka[]): Judoka[] {
  return groupSectionByIdenticalWeight(list).flatMap((g) => g.judokas)
}

/** Judokas pesés : Garçons puis Filles, regroupés par poids identique. */
export function sortWeighedForTriage(judokas: Judoka[]): { boys: Judoka[]; girls: Judoka[] } {
  const weighed = judokas.filter((j) => hasRecordedWeight(j.weightKg))
  const boys = sortSectionByIdenticalWeight(weighed.filter((j) => j.sex !== 'F'))
  const girls = sortSectionByIdenticalWeight(weighed.filter((j) => j.sex === 'F'))
  return { boys, girls }
}

/**
 * PDF triage : judokas pesés, sections Garçons / Filles, regroupés par poids identique.
 */
export async function exportWeighedTriagePdfBytes(judokas: Judoka[]): Promise<Uint8Array> {
  const { boys, girls } = sortWeighedForTriage(judokas)
  const title = pdfSafeText('Triage des judokas pesés - JudoVACapp')
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('JudoVACapp')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const pageW = 841.89
  const pageH = 595.28
  const tableW = COLS.reduce((s, c) => s + c.width, 0)
  const tableX = Math.max(MARGIN, (pageW - tableW) / 2)

  const navy = rgb(0.043, 0.122, 0.227)
  const headerBg = rgb(0.043, 0.122, 0.227)
  const zebra = rgb(0.94, 0.96, 0.98)
  const line = rgb(0.78, 0.82, 0.86)
  const text = rgb(0.08, 0.12, 0.18)
  const sectionBg = rgb(0.85, 0.12, 0.15)
  const weightBlockBg = rgb(0.92, 0.94, 0.97)
  const weightBlockBorder = rgb(0.55, 0.6, 0.68)

  let page = pdf.addPage([pageW, pageH])
  let y = pageH - MARGIN

  function drawDocHeader(): void {
    page.drawText(title, {
      x: MARGIN,
      y: y - TITLE_SIZE,
      size: TITLE_SIZE,
      font: fontBold,
      color: navy
    })
    y -= TITLE_SIZE + 6
    const meta = pdfSafeText(
      `Export du ${new Date().toLocaleString('fr-FR')} - ${boys.length + girls.length} pesé(s) · ${boys.length} garçon(s) · ${girls.length} fille(s) - regroupés par poids identique (sexe puis kg)`
    )
    page.drawText(truncate(font, meta, META_SIZE, pageW - MARGIN * 2), {
      x: MARGIN,
      y: y - META_SIZE,
      size: META_SIZE,
      font,
      color: text
    })
    y -= META_SIZE + 10
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

  function newPage(): void {
    page = pdf.addPage([pageW, pageH])
    y = pageH - MARGIN
    page.drawText(pdfSafeText(`${title} (suite)`), {
      x: MARGIN,
      y: y - 11,
      size: 11,
      font: fontBold,
      color: navy
    })
    y -= 18
    drawTableHeader()
  }

  function ensureSpace(needed: number): void {
    if (y - needed >= MARGIN) return
    newPage()
  }

  function drawSection(label: string, count: number): void {
    ensureSpace(SECTION_H + HEADER_H + ROW_H)
    page.drawRectangle({
      x: tableX,
      y: y - SECTION_H,
      width: tableW,
      height: SECTION_H,
      color: sectionBg
    })
    page.drawText(pdfSafeText(`${label} - ${count} judoka(s)`), {
      x: tableX + 8,
      y: y - SECTION_H + 6,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1)
    })
    y -= SECTION_H
    drawTableHeader()
  }

  function drawWeightBlockHeader(group: WeightGroup): void {
    ensureSpace(WEIGHT_BLOCK_H + ROW_H)
    page.drawRectangle({
      x: tableX,
      y: y - WEIGHT_BLOCK_H,
      width: tableW,
      height: WEIGHT_BLOCK_H,
      color: weightBlockBg,
      borderColor: weightBlockBorder,
      borderWidth: 0.8
    })
    const blockTitle = pdfSafeText(`Poids ${group.label} - ${group.judokas.length} judoka(s)`)
    page.drawText(blockTitle, {
      x: tableX + 8,
      y: y - WEIGHT_BLOCK_H + 4,
      size: 9,
      font: fontBold,
      color: navy
    })
    y -= WEIGHT_BLOCK_H
  }

  function drawRow(j: Judoka, rowIndex: number): void {
    ensureSpace(ROW_H)
    if (rowIndex % 2 === 1) {
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
      const cell = truncate(font, col.value(j, rowIndex), CELL_SIZE, col.width - 6)
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

  function drawWeightBlocks(list: Judoka[]): void {
    const groups = groupSectionByIdenticalWeight(list)
    let rowIndex = 0
    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0) y -= WEIGHT_BLOCK_GAP
      drawWeightBlockHeader(group)
      for (const j of group.judokas) {
        drawRow(j, rowIndex)
        rowIndex += 1
      }
      page.drawLine({
        start: { x: tableX, y },
        end: { x: tableX + tableW, y },
        thickness: 1.2,
        color: weightBlockBorder
      })
      y -= 4
    })
  }

  function drawRows(list: Judoka[]): void {
    drawWeightBlocks(list)
  }

  drawDocHeader()

  if (boys.length === 0 && girls.length === 0) {
    page.drawText(pdfSafeText('Aucun judoka pesé à trier.'), {
      x: tableX,
      y: y - 24,
      size: 11,
      font,
      color: text
    })
    return pdf.save()
  }

  if (boys.length > 0) {
    drawSection('Garçons', boys.length)
    drawRows(boys)
    y -= 10
  }
  if (girls.length > 0) {
    drawSection('Filles', girls.length)
    drawRows(girls)
  }

  return pdf.save()
}

export async function exportAndDownloadWeighedTriagePdf(judokas: Judoka[]): Promise<{
  filename: string
  count: number
}> {
  const { boys, girls } = sortWeighedForTriage(judokas)
  const bytes = await exportWeighedTriagePdfBytes(judokas)
  const filename = `triage-peses-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadPdfBytes(bytes, filename)
  return { filename, count: boys.length + girls.length }
}
