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

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    excludeAcceptAllOption?: boolean
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}

/** Force un fichier .jvac (évite que Chrome/Safari le renomme en .json). */
export async function downloadJvacFile(bytes: Uint8Array, filename: string): Promise<void> {
  const name = filename.toLowerCase().endsWith('.jvac')
    ? filename
    : `${filename.replace(/\.(json|txt|bin|gz|octet-stream)$/i, '')}.jvac`
  const payload = new Uint8Array(bytes)
  const blob = new Blob([payload], { type: 'application/x-jvac' })
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker

  if (typeof picker === 'function') {
    const handle = await picker({
      suggestedName: name,
      excludeAcceptAllOption: true,
      types: [
        {
          description: 'Sauvegarde JudoVACapp (.jvac)',
          accept: { 'application/x-jvac': ['.jvac'] }
        }
      ]
    })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }

  const file = new File([payload], name, { type: 'application/x-jvac' })
  downloadBlob(file, name)
}
