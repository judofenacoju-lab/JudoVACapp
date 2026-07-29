import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import {
  formatJudokaFullName,
  hasRecordedWeight,
  resolveJudokaCategory
} from '@shared/utils/judoka'
import { downloadPdfBytes } from '@/lib/judoka-list-pdf'

const MARGIN = 36
const ROW_H = 16
const HEADER_H = 18
const TITLE_SIZE = 14
const META_SIZE = 9
const CELL_SIZE = 8
const SECTION_H = 22

type Col = { key: string; label: string; width: number; value: (j: Judoka, i: number) => string }

const COLS: Col[] = [
  { key: 'n', label: 'N°', width: 28, value: (_j, i) => String(i + 1) },
  { key: 'id', label: 'ID', width: 70, value: (j) => j.displayId || '—' },
  { key: 'name', label: 'Nom complet', width: 150, value: (j) => formatJudokaFullName(j) || '—' },
  { key: 'age', label: 'Âge', width: 28, value: (j) => (j.age != null ? String(j.age) : '—') },
  {
    key: 'weight',
    label: 'Poids (kg)',
    width: 55,
    value: (j) => (j.weightKg != null ? String(j.weightKg) : '—')
  },
  { key: 'club', label: 'Club', width: 100, value: (j) => j.club || '—' },
  { key: 'grade', label: 'Grade', width: 50, value: (j) => j.grade || '—' },
  {
    key: 'cat',
    label: 'Catégorie',
    width: 70,
    value: (j) => resolveJudokaCategory(j.birthDate, j.category) || '—'
  },
  { key: 'license', label: 'Licence', width: 70, value: (j) => j.licenseNumber || '—' }
]

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

function normalizeWeightKey(weightKg: unknown): number {
  if (weightKg === null || weightKg === undefined) return 0
  const raw = typeof weightKg === 'string' ? weightKg.trim().replace(',', '.') : weightKg
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

/**
 * Regroupe par poids identique (même kg ensemble), puis nom à l'intérieur du groupe.
 * L'ordre des groupes de poids suit l'ordre d'apparition (pas de tri croissant global).
 */
function sortSectionByIdenticalWeight(list: Judoka[]): Judoka[] {
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

  const out: Judoka[] = []
  for (const key of keyOrder) {
    const group = groups.get(key)!
    group.sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
    out.push(...group)
  }
  return out
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
  const title = 'Triage des judokas pesés — JudoVACapp'
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
    const meta = `Export du ${new Date().toLocaleString('fr-FR')} — ${boys.length + girls.length} pesé(s) · ${boys.length} garçon(s) · ${girls.length} fille(s) — regroupés par poids identique (sexe puis kg)`
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
    page.drawText(`${title} (suite)`, {
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
    page.drawText(`${label} — ${count} judoka(s)`, {
      x: tableX + 8,
      y: y - SECTION_H + 6,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1)
    })
    y -= SECTION_H
    drawTableHeader()
  }

  function drawRows(list: Judoka[]): void {
    list.forEach((j, index) => {
      ensureSpace(ROW_H)
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
        const cell = truncate(font, col.value(j, index), CELL_SIZE, col.width - 6)
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
  }

  drawDocHeader()

  if (boys.length === 0 && girls.length === 0) {
    page.drawText('Aucun judoka pesé à trier.', {
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
