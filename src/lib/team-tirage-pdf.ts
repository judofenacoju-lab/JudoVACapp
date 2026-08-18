import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { Team } from '@shared/types/teams'
import type { TeamWeightClassRange } from '@shared/types/settings'
import {
  teamMatchesToBracket,
  teamTirageSnapshot,
  TEAM_TIRAGE_PDF_SUBJECT_PREFIX,
  type TeamTirageResult
} from '@shared/utils/team-tirage'
import { downloadBytes } from './download-blob'
import { appendBracketTreePages } from './tirage-bracket-pdf'

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/**
 * PDF de la grille par équipe, identique à l’affichage Tirage (tableau Blanc / Bleu).
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

  const bracket = teamMatchesToBracket(result.session.teamMatches ?? [])
  appendBracketTreePages(pdf, font, fontBold, {
    title: 'JudoVACapp - Grille par équipe',
    heading: 'Tableau des équipes',
    meta: `${result.teamCount} équipe(s) · ${result.matchCount} rencontre(s) · tableau ${bracket.size}`,
    bracket,
    phaseLabels: true
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
