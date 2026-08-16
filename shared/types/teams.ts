/** Équipe = un club + les judokas retenus pour les combats par équipe. */

export interface Team {
  id: string
  club: string
  name: string
  judokaIds: string[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export function createTeamId(): string {
  return `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function teamDisplayName(team: Team): string {
  const name = team.name.trim()
  const club = team.club.trim()
  if (name && name.toLowerCase() !== club.toLowerCase()) return `${name} (${club})`
  return club || name || 'Équipe'
}

export function normalizeTeams(raw: unknown): Team[] {
  if (!Array.isArray(raw)) return []
  const out: Team[] = []
  const seenClubs = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Partial<Team>
    const club = String(r.club ?? '').trim()
    if (!club) continue
    const key = club.toLowerCase()
    if (seenClubs.has(key)) continue
    seenClubs.add(key)
    const ids = Array.isArray(r.judokaIds)
      ? [...new Set(r.judokaIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
      : []
    const now = new Date().toISOString()
    out.push({
      id: String(r.id ?? '').trim() || createTeamId(),
      club,
      name: String(r.name ?? '').trim() || club,
      judokaIds: ids,
      createdBy: String(r.createdBy ?? '').trim() || 'inconnu',
      createdAt: String(r.createdAt ?? now),
      updatedAt: String(r.updatedAt ?? now)
    })
  }
  return out.sort((a, b) => a.club.localeCompare(b.club, 'fr'))
}
