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
const CLUB_H = 24
const WEIGHT_BLOCK_H = 15
const WEIGHT_BLOCK_GAP = 8

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
  {
    key: 'cat',
    label: pdfSafeText('Catégorie'),
    width: 80,
    value: (j) => pdfSafeText(resolveJudokaCategory(j.birthDate, j.category) || '-')
  },
  { key: 'grade', label: 'Grade', width: 50, value: (j) => pdfSafeText(j.grade || '-') },
  { key: 'license', label: 'Licence', width: 80, value: (j) => pdfSafeText(j.licenseNumber || '-') }
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

function clubName(j: Judoka): string {
  return j.club.trim() || 'Sans club'
}

function normalizeWeightKey(weightKg: unknown): number {
  if (weightKg === null || weightKg === undefined) return 0
  const raw = typeof weightKg === 'string' ? weightKg.trim().replace(',', '.') : weightKg
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

function formatWeightLabel(weightKg: number): string {
  return Number.isInteger(weightKg) ? `${weightKg} kg` : `${weightKg.toFixed(1).replace('.', ',')} kg`
}

type WeightBucket = { weightKg: number; label: string; judokas: Judoka[] }
type SexBucket = { sexLabel: string; weights: WeightBucket[] }
type ClubBucket = { club: string; sexes: SexBucket[] }

/**
 * Pesés uniquement → Club → Garçons/Filles → catégorie de poids (kg enregistré).
 * Indépendant de la configuration Tirage.
 */
export function buildTriageByClub(judokas: Judoka[]): {
  clubs: ClubBucket[]
  weighedCount: number
} {
  const weighed = judokas.filter((j) => hasRecordedWeight(j.weightKg))

  // club -> sex -> weightKey -> judokas
  const byClub = new Map<string, Map<string, Map<number, Judoka[]>>>()

  for (const j of weighed) {
    const club = clubName(j)
    const sexKey = j.sex === 'F' ? 'F' : 'M'
    const wKey = normalizeWeightKey(j.weightKg)
    if (!byClub.has(club)) byClub.set(club, new Map())
    const sexMap = byClub.get(club)!
    if (!sexMap.has(sexKey)) sexMap.set(sexKey, new Map())
    const weightMap = sexMap.get(sexKey)!
    if (!weightMap.has(wKey)) weightMap.set(wKey, [])
    weightMap.get(wKey)!.push(j)
  }

  const clubs: ClubBucket[] = [...byClub.entries()]
    .sort((a, b) => {
      if (a[0] === 'Sans club') return 1
      if (b[0] === 'Sans club') return -1
      return a[0].localeCompare(b[0], 'fr')
    })
    .map(([club, sexMap]) => {
      const sexes: SexBucket[] = (['M', 'F'] as const)
        .filter((s) => sexMap.has(s))
        .map((sexKey) => {
          const weightMap = sexMap.get(sexKey)!
          const weights: WeightBucket[] = [...weightMap.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([weightKg, list]) => ({
              weightKg,
              label: formatWeightLabel(weightKg),
              judokas: [...list].sort((a, b) =>
                formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
              )
            }))
          return {
            sexLabel: sexKey === 'F' ? 'Filles' : 'Garçons',
            weights
          }
        })
      return { club, sexes }
    })

  return { clubs, weighedCount: weighed.length }
}

/**
 * PDF triage : Club → Garçons / Filles → poids (kg), judokas déjà pesés uniquement.
 */
export async function exportWeighedTriagePdfBytes(judokas: Judoka[]): Promise<Uint8Array> {
  const { clubs, weighedCount } = buildTriageByClub(judokas)
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
  const clubBg = rgb(0.043, 0.122, 0.227)
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
      `Export du ${new Date().toLocaleString('fr-FR')} - ${weighedCount} pesé(s) · par club, sexe, catégorie de poids`
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

  function drawClubHeader(label: string, count: number): void {
    ensureSpace(CLUB_H + SECTION_H + HEADER_H + ROW_H)
    page.drawRectangle({
      x: tableX,
      y: y - CLUB_H,
      width: tableW,
      height: CLUB_H,
      color: clubBg
    })
    page.drawText(
      truncate(fontBold, pdfSafeText(`${label}  (${count})`), 11, tableW - 12),
      {
        x: tableX + 6,
        y: y - CLUB_H + 7,
        size: 11,
        font: fontBold,
        color: rgb(1, 1, 1)
      }
    )
    y -= CLUB_H
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
    page.drawText(pdfSafeText(`${label}  (${count})`), {
      x: tableX + 6,
      y: y - SECTION_H + 6,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1)
    })
    y -= SECTION_H
    drawTableHeader()
  }

  function drawWeightBlockHeader(label: string, count: number): void {
    ensureSpace(WEIGHT_BLOCK_H + ROW_H)
    page.drawRectangle({
      x: tableX,
      y: y - WEIGHT_BLOCK_H,
      width: tableW,
      height: WEIGHT_BLOCK_H,
      color: weightBlockBg,
      borderColor: weightBlockBorder,
      borderWidth: 0.6
    })
    page.drawText(
      truncate(fontBold, pdfSafeText(`${label}  · ${count}`), 8, tableW - 10),
      {
        x: tableX + 5,
        y: y - WEIGHT_BLOCK_H + 4,
        size: 8,
        font: fontBold,
        color: navy
      }
    )
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
    let x = tableX
    for (const col of COLS) {
      const raw = col.value(j, rowIndex)
      page.drawText(truncate(font, raw, CELL_SIZE, col.width - 4), {
        x: x + 2,
        y: y - ROW_H + 4,
        size: CELL_SIZE,
        font,
        color: text
      })
      x += col.width
    }
    page.drawLine({
      start: { x: tableX, y: y - ROW_H },
      end: { x: tableX + tableW, y: y - ROW_H },
      thickness: 0.4,
      color: line
    })
    y -= ROW_H
  }

  drawDocHeader()

  if (clubs.length === 0) {
    page.drawText(pdfSafeText('Aucun judoka pesé à trier.'), {
      x: tableX,
      y: y - 24,
      size: 11,
      font,
      color: text
    })
    return pdf.save()
  }

  for (const club of clubs) {
    const clubCount = club.sexes.reduce(
      (s, sex) => s + sex.weights.reduce((n, w) => n + w.judokas.length, 0),
      0
    )
    drawClubHeader(club.club, clubCount)
    for (const sex of club.sexes) {
      const sexCount = sex.weights.reduce((n, w) => n + w.judokas.length, 0)
      drawSection(sex.sexLabel, sexCount)
      sex.weights.forEach((bucket, idx) => {
        if (idx > 0) y -= WEIGHT_BLOCK_GAP
        drawWeightBlockHeader(bucket.label, bucket.judokas.length)
        bucket.judokas.forEach((j, i) => drawRow(j, i))
        page.drawLine({
          start: { x: tableX, y },
          end: { x: tableX + tableW, y },
          thickness: 1.2,
          color: weightBlockBorder
        })
        y -= 4
      })
      y -= 8
    }
    y -= 10
  }

  return pdf.save()
}

export async function exportAndDownloadWeighedTriagePdf(judokas: Judoka[]): Promise<{
  filename: string
  count: number
}> {
  const { weighedCount } = buildTriageByClub(judokas)
  const bytes = await exportWeighedTriagePdfBytes(judokas)
  const filename = `triage-peses-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadPdfBytes(bytes, filename)
  return { filename, count: weighedCount }
}
