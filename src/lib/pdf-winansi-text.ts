/**
 * Helvetica / StandardFonts (pdf-lib) = encodage WinAnsi.
 * Les noms en NFD (ex. "e" + U+0302) ou certains tirets Unicode font planter drawText.
 */
export function pdfSafeText(input: string): string {
  let s = input.normalize('NFC')

  s = s
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00A0/g, ' ')
    // Accents combinants restants (pas de précomposé WinAnsi)
    .replace(/[\u0300-\u036f]/g, '')

  // Tout codepoint hors Latin-1 : retirer les diacritiques, sinon '?'
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
