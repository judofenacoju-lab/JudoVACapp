/**
 * Helvetica / StandardFonts (pdf-lib, PDFKit) = encodage WinAnsi.
 * Les noms en NFD (ex. "e" + U+0302) ou certains tirets Unicode font planter.
 * On compose en NFC (garde é, à, etc. Latin-1), puis on retire les combinants restants.
 */
export function pdfSafeText(input: string): string {
  let s = input.normalize('NFC')

  s = s
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212\u2010\u2011]/g, '-')
    .replace(/[\u00A0\u202F\u2007\u2009]/g, ' ')
    // Accents combinants restants (ex. ̂ U+0302 isolé / NFD non recomposé)
    .replace(/[\u0300-\u036f]/g, '')

  // Hors Latin-1 : replier les diacritiques, sinon '?'
  s = [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      if (cp <= 0xff) return ch
      const folded = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (folded && [...folded].every((c) => (c.codePointAt(0) ?? 0) <= 0xff)) {
        return folded
      }
      return '?'
    })
    .join('')

  return s
}
