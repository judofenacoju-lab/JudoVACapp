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
  window.setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 4_000)
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime = 'application/pdf'
): void {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: mime }), filename)
}

/** Force un fichier .jvac (évite que Chrome/Safari le renomme en .json). */
export async function downloadJvacFile(bytes: Uint8Array, filename: string): Promise<void> {
  const name = filename.toLowerCase().endsWith('.jvac')
    ? filename
    : `${filename.replace(/\.(json|txt|bin|gz|octet-stream)$/i, '')}.jvac`
  // octet-stream : téléchargement immédiat, sans File System Access (souvent bloqué après un long async).
  const payload = new Uint8Array(bytes)
  const blob = new Blob([payload], { type: 'application/octet-stream' })
  downloadBlob(blob, name)
}
