import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Judoka } from '@shared/types/judoka'
import { formatCreatorLabel } from '@shared/utils/creator'
import { downloadPdfBytes } from '@/lib/judoka-list-pdf'

export interface UserClubsFiche {
  username: string
  judokaCount: number
  clubs: Array<{ name: string; count: number }>
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

/** Regroupe les judokas par utilisateur puis par club. */
export function buildUserClubsFiches(judokas: Judoka[]): UserClubsFiche[] {
  const byUser = new Map<string, Judoka[]>()
  for (const j of judokas) {
    const user = formatCreatorLabel(j.createdBy)
    const list = byUser.get(user) ?? []
    list.push(j)
    byUser.set(user, list)
  }

  const fiches: UserClubsFiche[] = [...byUser.entries()].map(([username, items]) => {
    const clubMap = new Map<string, number>()
    for (const j of items) {
      const club = j.club.trim() || 'Sans club'
      clubMap.set(club, (clubMap.get(club) ?? 0) + 1)
    }
    const clubs = [...clubMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === 'Sans club') return 1
        if (b.name === 'Sans club') return -1
        return a.name.localeCompare(b.name, 'fr')
      })
    return { username, judokaCount: items.length, clubs }
  })

  fiches.sort((a, b) => {
    if (a.username === 'Serveur') return -1
    if (b.username === 'Serveur') return 1
    return a.username.localeCompare(b.username, 'fr')
  })
  return fiches
}

/**
 * PDF « Fiche Utilisateurs » : chaque utilisateur + clubs enregistrés.
 */
export async function exportUserClubsPdfBytes(fiches: UserClubsFiche[]): Promise<Uint8Array> {
  const title = 'Fiche Utilisateurs — JudoVACapp'
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('JudoVACapp')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const pageW = 595.28
  const pageH = 841.89
  const margin = 40
  const contentW = pageW - margin * 2
  const navy = rgb(0.043, 0.122, 0.227)
  const text = rgb(0.08, 0.12, 0.18)
  const muted = rgb(0.4, 0.45, 0.5)
  const line = rgb(0.82, 0.85, 0.88)

  let page = pdf.addPage([pageW, pageH])
  let y = pageH - margin

  function ensureSpace(needed: number): void {
    if (y - needed >= margin) return
    page = pdf.addPage([pageW, pageH])
    y = pageH - margin
  }

  page.drawText(title, { x: margin, y: y - 16, size: 16, font: fontBold, color: navy })
  y -= 22
  page.drawText(
    `Export du ${new Date().toLocaleString('fr-FR')} — ${fiches.length} utilisateur(s)`,
    { x: margin, y: y - 10, size: 9, font, color: muted }
  )
  y -= 24

  if (fiches.length === 0) {
    page.drawText('Aucun utilisateur avec des judokas enregistrés.', {
      x: margin,
      y: y - 12,
      size: 11,
      font,
      color: text
    })
    return pdf.save()
  }

  for (const fiche of fiches) {
    const blockH = 28 + Math.max(1, fiche.clubs.length) * 16 + 12
    ensureSpace(blockH)

    page.drawRectangle({
      x: margin,
      y: y - 22,
      width: contentW,
      height: 22,
      color: navy
    })
    page.drawText(
      truncate(fontBold, fiche.username, 11, contentW - 120),
      { x: margin + 8, y: y - 15, size: 11, font: fontBold, color: rgb(1, 1, 1) }
    )
    const right = `${fiche.judokaCount} judoka(s) · ${fiche.clubs.length} club(s)`
    const rightW = font.widthOfTextAtSize(right, 9)
    page.drawText(right, {
      x: margin + contentW - rightW - 8,
      y: y - 15,
      size: 9,
      font,
      color: rgb(1, 1, 1)
    })
    y -= 28

    if (fiche.clubs.length === 0) {
      page.drawText('Aucun club', { x: margin + 12, y: y - 12, size: 10, font, color: muted })
      y -= 20
    } else {
      for (const club of fiche.clubs) {
        ensureSpace(18)
        page.drawText('•', { x: margin + 10, y: y - 12, size: 10, font, color: navy })
        page.drawText(
          truncate(font, club.name, 10, contentW - 80),
          { x: margin + 22, y: y - 12, size: 10, font, color: text }
        )
        const countLabel = String(club.count)
        const cw = font.widthOfTextAtSize(countLabel, 10)
        page.drawText(countLabel, {
          x: margin + contentW - cw - 8,
          y: y - 12,
          size: 10,
          font: fontBold,
          color: navy
        })
        y -= 16
        page.drawLine({
          start: { x: margin + 8, y },
          end: { x: margin + contentW - 8, y },
          thickness: 0.4,
          color: line
        })
        y -= 4
      }
    }
    y -= 10
  }

  return pdf.save()
}

export async function exportAndDownloadUserClubsPdf(judokas: Judoka[]): Promise<{
  filename: string
  userCount: number
}> {
  const fiches = buildUserClubsFiches(judokas)
  const bytes = await exportUserClubsPdfBytes(fiches)
  const filename = `fiche-utilisateurs-${new Date().toISOString().slice(0, 10)}.pdf`
  downloadPdfBytes(bytes, filename)
  return { filename, userCount: fiches.length }
}
