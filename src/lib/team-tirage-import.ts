import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream
} from 'pdf-lib'
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

function winAnsiFromHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length < 2) return ''
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`
  const bytes = new Uint8Array(padded.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return new TextDecoder('latin1').decode(bytes)
}

function decodeContentStream(stream: unknown): string {
  if (!(stream instanceof PDFRawStream)) return ''
  try {
    const decoded = decodePDFRawStream(stream).decode()
    return new TextDecoder('latin1').decode(decoded)
  } catch {
    try {
      return new TextDecoder('latin1').decode(stream.getContents())
    } catch {
      return ''
    }
  }
}

function collectContentStreams(node: unknown): PDFRawStream[] {
  if (node instanceof PDFRawStream) return [node]
  if (node instanceof PDFArray) {
    const out: PDFRawStream[] = []
    for (let i = 0; i < node.size(); i++) {
      out.push(...collectContentStreams(node.lookup(i)))
    }
    return out
  }
  return []
}

function stringsFromContent(content: string): string[] {
  const out: string[] = []
  const tokenRe = /<([0-9A-Fa-f \r\n\t]+)>|\((?:\\.|[^\\)])*\)/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(content))) {
    if (m[1] != null) {
      const value = winAnsiFromHex(m[1]).trim()
      if (value) out.push(value)
      continue
    }
    const value = unescapePdfLiteral(m[0].slice(1, -1)).trim()
    if (value) out.push(value)
  }
  return out
}

function extractPdfStrings(pdf: PDFDocument): string[] {
  const out: string[] = []
  for (const page of pdf.getPages()) {
    const streams = collectContentStreams(page.node.Contents())
    for (const stream of streams) {
      const content = decodeContentStream(stream)
      if (!content) continue
      out.push(...stringsFromContent(content))
    }
  }
  if (out.length > 0) return out

  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const content = decodeContentStream(obj)
    if (!/Tj|TJ/.test(content)) continue
    out.push(...stringsFromContent(content))
  }
  return out
}

function parseMatchesFromLiterals(literals: string[]): ImportedTeamMatchLine[] {
  const matches: ImportedTeamMatchLine[] = []
  let current: ImportedTeamMatchLine | null = null
  let lastPool = ''

  const headerRe =
    /^(.+?)\s*[·•]\s*(.+?)\s*\(\s*A\s*bleu\s*\)\s*vs\s*(.+?)\s*\(\s*B\s*rouge\s*\)\s*$/i
  const boutRe = /^(.+?)\s*\(\s*A\s*\)\s*vs\s*(.+?)\s*\(\s*B\s*\)\s*$/i
  const poolRe = /^(Gar[cç]ons|Filles)\s*[·•]\s*.+$/i

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

  const imported = parseMatchesFromLiterals(extractPdfStrings(pdf))
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
