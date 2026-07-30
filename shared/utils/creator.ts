/** Libellé affiché pour l'auteur d'un enregistrement judoka. */
export function formatCreatorLabel(createdBy: string | undefined | null): string {
  const raw = (createdBy ?? '').trim()
  if (!raw || raw.toLowerCase() === 'serveur') return 'Serveur'
  return raw
}

/** Valeur interne pour filtrer les judokas créés par le serveur local. */
export function isServerCreator(createdBy: string | undefined | null): boolean {
  const raw = (createdBy ?? '').trim().toLowerCase()
  return !raw || raw === 'serveur'
}

/** Valeur `created_by` à persister en base à partir du libellé affiché. */
export function resolveCreatedByStorageValue(label: string): string {
  const raw = (label ?? '').trim()
  if (!raw || raw.toLowerCase() === 'serveur') return 'serveur'
  return raw
}

/** Compare un enregistrement à un libellé utilisateur affiché (ex. « Serveur »). */
export function matchesCreatorLabel(
  createdBy: string | undefined | null,
  label: string
): boolean {
  return formatCreatorLabel(createdBy) === formatCreatorLabel(label)
}
