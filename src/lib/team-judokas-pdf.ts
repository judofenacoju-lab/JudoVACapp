import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import type { TeamWeightClassRange } from '@shared/types/settings'
import { judokasOnTeam, teamDisplayName, type Team } from '@shared/types/teams'
import { formatJudokaFullName } from '@shared/utils/judoka'
import { normalizeTeamWeightClasses } from '@shared/utils/team-tirage'
import { downloadPdfBytes } from '@/lib/judoka-list-pdf'
import { pdfSafeText } from '@/lib/pdf-winansi-text'

const MARGIN = 36
const ROW_H = 16
const HEADER_H = 18
const CLUB_H = 20
const CAT_H = 16
const TITLE_SIZE = 14
const META_SIZE = 9
const CELL_SIZE = 8

type Col = { label: string; width: number; value: (j: Judoka, i: number) => string }

const COLS: Col[] = [
  { label: 'N°', width: 28, value: (_j, i) => String(i + 1) },
  { label: 'ID', width: 88, value: (j) => j.displayId || '-' },
  { label: 'Nom complet', width: 210, value: (j) => formatJudokaFullName(j) || '-' },
  { label: 'Sexe', width: 40, value: (j) => (j.sex === 'F' ? 'F' : 'M') },
  { label: 'Age', width: 36, value: (j) => (j.age != null ? String(j.age) : '-') },
  {
    label: 'Poids',
    width: 50,
    value: (j) => (j.weightKg != null ? `${j.weightKg}` : '-')
  },
  { label: 'Grade', width: 70, value: (j) => j.grade || '-' },
  { label: 'Licence', width: 90, value: (j) => j.licenseNumber || '-' }
]

export interface TeamRosterCategoryBlock {
  label: string
  items: Judoka[]
}

export interface TeamRosterClubGroup {
  club: string
  teamName: string
  items: Judoka[]
  categories: TeamRosterCategoryBlock[]
}

function judokaWeight(j: Judoka): number {
  const n = Number(j.weightKg)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function inWeightClass(j: Judoka, wc: TeamWeightClassRange): boolean {
  if (j.sex !== wc.sex) return false
  const w = judokaWeight(j)
  if (w <= 0) return false
  return w >= wc.minKg - 1e-9 && w <= wc.maxKg + 1e-9
}

function categoryLabel(wc: TeamWeightClassRange): string {
  const sex = wc.sex === 'F' ? 'Filles' : 'Garçons'
  return `${sex} · ${wc.label}`
}

function sortClasses(a: TeamWeightClassRange, b: TeamWeightClassRange): number {
  if (a.sex !== b.sex) return a.sex === 'M' ? -1 : 1
  return a.maxKg - b.maxKg || a.label.localeCompare(b.label, 'fr')
}

/** Regroupe les judokas d’équipe par club, puis par catégorie de poids. */
export function groupTeamRosterByClubAndCategory(
  teams: Team[],
  judokas: Judoka[],
  weightClasses: TeamWeightClassRange[]
): TeamRosterClubGroup[] {
  const classes = normalizeTeamWeightClasses(weightClasses).slice().sort(sortClasses)
  const groups: TeamRosterClubGroup[] = []

  for (const team of [...teams].sort((a, b) => a.club.localeCompare(b.club, 'fr'))) {
    const members = judokasOnTeam(team, judokas).sort((a, b) =>
      formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
    )
    if (members.length === 0) continue

    const used = new Set<string>()
    const categories: TeamRosterCategoryBlock[] = []
    for (const wc of classes) {
      const items = members.filter((j) => !used.has(j.id) && inWeightClass(j, wc))
      if (items.length === 0) continue
      for (const j of items) used.add(j.id)
      categories.push({ label: categoryLabel(wc), items })
    }
    const leftover = members.filter((j) => !used.has(j.id))
    if (leftover.length > 0) {
      categories.push({ label: 'Non classés', items: leftover })
    }

    groups.push({
      club: team.club.trim() || 'Sans club',
      teamName: teamDisplayName(team),
      items: members,
      categories
    })
  }

  return groups
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

export async function exportTeamJudokasPdfBytes(options: {
  teams: Team[]
  judokas: Judoka[]
  weightClasses: TeamWeightClassRange[]
}): Promise<Uint8Array> {
  const groups = groupTeamRosterByClubAndCategory(
    options.teams,
    options.judokas,
    options.weightClasses
  )
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const title = 'Liste des judokas par equipe - JudoVACapp'

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
  const clubBg = rgb(0.85, 0.12, 0.15)
  const catBg = rgb(0.043, 0.122, 0.227)
  const zebra = rgb(0.94, 0.96, 0.98)
  const line = rgb(0.78, 0.82, 0.86)
  const text = rgb(0.08, 0.12, 0.18)

  let page = pdf.addPage([pageW, pageH])
  let y = pageH - MARGIN

  function newPage(): void {
    page = pdf.addPage([pageW, pageH])
    y = pageH - MARGIN
  }

  function ensureSpace(h: number): void {
    if (y - h < MARGIN) {
      newPage()
      drawHeaderBlock(true)
      drawTableHeader()
    }
  }

  function drawHeaderBlock(isContinuation = false): void {
    page.drawText(pdfSafeText(isContinuation ? `${title} (suite)` : title), {
      x: MARGIN,
      y: y - TITLE_SIZE,
      size: isContinuation ? 11 : TITLE_SIZE,
      font: fontBold,
      color: navy
    })
    y -= TITLE_SIZE + 6
    const meta = `Export du ${new Date().toLocaleString('fr-FR')} — ${total} judoka(s) · ${groups.length} club(s)`
    page.drawText(pdfSafeText(meta), {
      x: MARGIN,
      y: y - META_SIZE,
      size: META_SIZE,
      font,
      color: rgb(0.35, 0.4, 0.45)
    })
    y -= META_SIZE + 10
  }

  function drawTableHeader(): void {
    ensureSpace(HEADER_H)
    page.drawRectangle({
      x: tableX,
      y: y - HEADER_H,
      width: tableW,
      height: HEADER_H,
      color: navy
    })
    let x = tableX
    for (const col of COLS) {
      page.drawText(pdfSafeText(col.label), {
        x: x + 3,
        y: y - HEADER_H + 5,
        size: 8,
        font: fontBold,
        color: rgb(1, 1, 1)
      })
      x += col.width
    }
    y -= HEADER_H
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
    page.drawText(truncate(fontBold, pdfSafeText(`${club}  (${count})`), 10, tableW - 12), {
      x: tableX + 6,
      y: y - CLUB_H + 6,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1)
    })
    y -= CLUB_H
  }

  function drawCategoryHeader(label: string, count: number): void {
    ensureSpace(CAT_H + ROW_H)
    page.drawRectangle({
      x: tableX,
      y: y - CAT_H,
      width: tableW,
      height: CAT_H,
      color: catBg
    })
    page.drawText(
      truncate(fontBold, pdfSafeText(`${label}  (${count})`), 8, tableW - 12),
      {
        x: tableX + 6,
        y: y - CAT_H + 4,
        size: 8,
        font: fontBold,
        color: rgb(1, 1, 1)
      }
    )
    y -= CAT_H
  }

  function drawRow(j: Judoka, indexInCat: number, zebraOn: boolean): void {
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
      const cell = truncate(font, col.value(j, indexInCat), CELL_SIZE, col.width - 6)
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

  if (total === 0) {
    page.drawText(pdfSafeText('Aucun judoka inscrit dans une equipe.'), {
      x: tableX,
      y: y - 24,
      size: 11,
      font,
      color: text
    })
    return pdf.save()
  }

  for (const group of groups) {
    drawClubHeader(group.teamName || group.club, group.items.length)
    for (const cat of group.categories) {
      drawCategoryHeader(cat.label, cat.items.length)
      cat.items.forEach((j, i) => drawRow(j, i, i % 2 === 1))
    }
  }

  return pdf.save()
}

export async function exportAndDownloadTeamJudokasPdf(options: {
  teams: Team[]
  judokas: Judoka[]
  weightClasses: TeamWeightClassRange[]
}): Promise<{ filename: string; judokaCount: number; clubCount: number }> {
  const groups = groupTeamRosterByClubAndCategory(
    options.teams,
    options.judokas,
    options.weightClasses
  )
  const bytes = await exportTeamJudokasPdfBytes(options)
  const filename = `liste-judokas-par-equipe-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadPdfBytes(bytes, filename)
  return {
    filename,
    judokaCount: groups.reduce((n, g) => n + g.items.length, 0),
    clubCount: groups.length
  }
}
