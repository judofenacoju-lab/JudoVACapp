/**
 * Téléchargement Blob fiable (Chrome/Safari Mac + Windows).
 * — attache le lien au DOM (Safari l’exige souvent)
 * — pas de window.open (bloqué hors geste utilisateur)
 * — revoke différé (Safari peut annuler le download si revoke immédiat)
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime = 'application/pdf'
): void {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: mime }), filename)
}
