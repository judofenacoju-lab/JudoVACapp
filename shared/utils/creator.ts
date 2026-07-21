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
