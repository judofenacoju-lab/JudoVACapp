import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { Team } from '@shared/types/teams'
import type { TeamWeightClassRange } from '@shared/types/settings'
import {
  teamTirageSnapshot,
  TEAM_TIRAGE_PDF_SUBJECT_PREFIX,
  type TeamTirageResult
} from '@shared/utils/team-tirage'
import { downloadBytes } from './download-blob'
import { pdfSafeText } from './pdf-winansi-text'

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const NAVY = rgb(0.043, 0.122, 0.227)
const MUTED = rgb(0.35, 0.4, 0.45)
const LINE = rgb(0.78, 0.82, 0.86)
const ZEBRA = rgb(0.94, 0.96, 0.98)
const WHITE = rgb(1, 1, 1)

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
 * PDF de la grille des combats par équipe (rencontres + bouts).
 */
export async function exportTeamTiragePdfBytes(
  result: TeamTirageResult,
  extras: { teams?: Team[]; weightClasses?: TeamWeightClassRange[] } = {}
): Promise<Uint8Array> {
  const snapshot = teamTirageSnapshot(result, extras.teams ?? [], extras.weightClasses ?? [])
  const pdf = await PDFDocument.create()
  pdf.setTitle('Grille des combats par équipe — JudoVACapp')
  pdf.setAuthor('JudoVACapp')
  pdf.setKeywords(['judovac-team-tirage'])
  pdf.setSubject(`${TEAM_TIRAGE_PDF_SUBJECT_PREFIX}${utf8ToBase64(JSON.stringify(snapshot))}`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const matches = [...(result.session.teamMatches ?? [])].sort(
    (a, b) => a.round - b.round || a.matchIndex - b.matchIndex
  )
  const contentW = PAGE_W - MARGIN * 2

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  const ensureSpace = (needed: number): void => {
    if (y - needed >= MARGIN) return
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }

  const drawText = (
    text: string,
    x: number,
    yy: number,
    size: number,
    bold = false,
    color = NAVY,
    maxW = contentW
  ): void => {
    const used = bold ? fontBold : font
    page.drawText(truncate(used, text, size, maxW), {
      x,
      y: yy,
      size,
      font: used,
      color
    })
  }

  drawText('JudoVACapp — Grille par équipe', MARGIN, y - 14, 16, true)
  y -= 22
  drawText(
    `${result.teamCount} équipes · ${result.matchCount} rencontre(s) · ${result.boutCount} combat(s)`,
    MARGIN,
    y - 10,
    10,
    false,
    MUTED
  )
  y -= 28

  if (matches.length === 0) {
    drawText('Aucun combat à exporter.', MARGIN, y - 12, 11, false, MUTED)
    return pdf.save()
  }

  const rowH = 26
  matches.forEach((match, index) => {
    ensureSpace(rowH + 4)
    const bg = index % 2 === 0 ? ZEBRA : WHITE
    page.drawRectangle({
      x: MARGIN,
      y: y - rowH,
      width: contentW,
      height: rowH,
      color: bg,
      borderColor: LINE,
      borderWidth: 0.4
    })
    drawText(
      `${match.label} · ${match.homeClub} (A bleu) vs ${match.awayClub} (B rouge)`,
      MARGIN + 8,
      y - 17,
      10,
      true,
      NAVY
    )
    y -= rowH
  })

  return pdf.save()
}

export async function exportAndDownloadTeamTiragePdf(
  result: TeamTirageResult,
  extras: { teams?: Team[]; weightClasses?: TeamWeightClassRange[] } = {}
): Promise<{ filename: string; matchCount: number }> {
  const bytes = await exportTeamTiragePdfBytes(result, extras)
  const filename = `grille-equipe-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadBytes(bytes, filename, 'application/pdf')
  return {
    filename,
    matchCount: (result.session.teamMatches ?? []).filter((m) => m.round === 0).length
  }
}
