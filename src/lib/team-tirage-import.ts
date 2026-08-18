import { PDFDocument } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import type { Team } from '@shared/types/teams'
import type { TeamWeightClassRange } from '@shared/types/settings'
import {
  generateTeamTirageFromImportedMatches,
  isTeamTiragePdfSnapshot,
  TEAM_TIRAGE_PDF_SUBJECT_PREFIX,
  teamTirageResultFromSnapshot,
  type ImportedTeamMatchLine,
  type TeamTirageResult
} from '@shared/utils/team-tirage'

function base64ToUtf8(value: string): string {
  const bin = atob(value)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function unescapePdfLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
}

function extractPdfLiterals(bytes: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(bytes)
  const out: string[] = []
  const re = /\((?:\\.|[^\\)])*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const inner = m[0].slice(1, -1)
    const value = unescapePdfLiteral(inner).trim()
    if (value) out.push(value)
  }
  return out
}

function parseMatchesFromLiterals(literals: string[]): ImportedTeamMatchLine[] {
  const matches: ImportedTeamMatchLine[] = []
  let current: ImportedTeamMatchLine | null = null
  let lastPool = ''

  const headerRe =
    /^(.+?)\s*[·•]\s*(.+?)\s*\(A\s*bleu\)\s*vs\s*(.+?)\s*\(B\s*rouge\)\s*$/i
  const boutRe = /^(.+?)\s*\(A\)\s*vs\s*(.+?)\s*\(B\)\s*$/i
  const poolRe = /^(Garçons|Filles)\s*[·•]\s*.+$/i

  for (const line of literals) {
    const header = line.match(headerRe)
    if (header) {
      current = {
        label: header[1]!.trim(),
        homeClub: header[2]!.trim(),
        awayClub: header[3]!.trim(),
        bouts: []
      }
      matches.push(current)
      lastPool = ''
      continue
    }
    if (poolRe.test(line)) {
      lastPool = line
      continue
    }
    const bout = line.match(boutRe)
    if (bout && current) {
      current.bouts.push({
        poolLabel: lastPool,
        topName: bout[1]!.trim(),
        bottomName: bout[2]!.trim()
      })
    }
  }
  return matches
}

/**
 * Lit un PDF de grille par équipe (export JudoVACapp) et reconstruit le tirage.
 */
export async function importTeamTirageFromPdf(
  bytes: Uint8Array,
  teams: Team[],
  judokas: Judoka[],
  weightClasses: TeamWeightClassRange[]
): Promise<TeamTirageResult> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const subject = pdf.getSubject()?.trim() ?? ''
  if (subject.startsWith(TEAM_TIRAGE_PDF_SUBJECT_PREFIX)) {
    try {
      const json = base64ToUtf8(subject.slice(TEAM_TIRAGE_PDF_SUBJECT_PREFIX.length))
      const parsed: unknown = JSON.parse(json)
      if (isTeamTiragePdfSnapshot(parsed)) {
        const result = teamTirageResultFromSnapshot(parsed, teams, judokas)
        if (result.matchCount > 0 || (result.session.teamMatches?.length ?? 0) > 0) {
          return result
        }
      }
    } catch {
      /* repli sur le texte visible */
    }
  }

  const imported = parseMatchesFromLiterals(extractPdfLiterals(bytes))
  if (imported.length === 0) {
    throw new Error(
      'Ce PDF n’est pas une grille de tirage par équipe JudoVACapp, ou les combats n’ont pas pu être lus.'
    )
  }
  const result = generateTeamTirageFromImportedMatches(imported, teams, judokas, weightClasses)
  if (result.matchCount === 0) {
    throw new Error('Aucun combat d’équipe n’a pu être reconstitué depuis ce PDF.')
  }
  return result
}
