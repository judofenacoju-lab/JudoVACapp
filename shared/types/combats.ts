import type { Sex } from '@shared/types/judoka'
import type { TirageFighter, TirageResult } from '@shared/utils/tirage'
import { formatTirageCategoryName } from '@shared/utils/tirage'

/** Statut d’un combat suivi sur le terrain. */
export type CombatStatus = 'pending' | 'ready' | 'in_progress' | 'completed'

export interface CombatFighterRef {
  id: string
  displayId: string
  name: string
  club: string
  age: number
  sex: Sex
  category: string
  weightKg: number
}

export interface Tatami {
  id: string
  name: string
  createdAt: string
}

export interface ManagedCombat {
  id: string
  matchId: string
  label: string
  round: number
  matchIndex: number
  poolKey: string
  poolLabel: string
  sex: Sex
  category: string
  weightLabel: string
  top: CombatFighterRef | null
  bottom: CombatFighterRef | null
  bye: boolean
  /** Tatami assigné (null = non réparti). */
  tatamiId: string | null
  /** Ordre sur le tatami (0 = premier). */
  orderOnTatami: number
  status: CombatStatus
  winnerId: string | null
  /** Combat suivant alimenté par le vainqueur. */
  feedsInto: { combatId: string; slot: 'top' | 'bottom' } | null
  updatedAt: string
}

/** Session Combats : brouillon depuis Tirage, puis confirmée pour le suivi. */
export interface CombatSession {
  id: string
  sourceTirageAt: string
  /** null = importé du tirage, pas encore confirmé. */
  confirmedAt: string | null
  tatamis: Tatami[]
  combats: ManagedCombat[]
  updatedAt: string
}

export function createEmptyCombatSession(): CombatSession {
  const now = new Date().toISOString()
  return {
    id: `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sourceTirageAt: now,
    confirmedAt: null,
    tatamis: [],
    combats: [],
    updatedAt: now
  }
}

export function createTatamiId(): string {
  return `tat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function fighterRef(f: TirageFighter | null | undefined): CombatFighterRef | null {
  if (!f) return null
  return {
    id: f.id,
    displayId: f.displayId,
    name: f.name,
    club: f.club,
    age: f.age,
    sex: f.sex,
    category: f.category,
    weightKg: f.weightKg
  }
}

function fighterLabel(f: CombatFighterRef | null): string {
  if (!f) return '—'
  return f.name
}

/** Libellé court pour listes (noms + pool). */
export function formatCombatSummary(c: ManagedCombat): string {
  return `${c.label} · ${fighterLabel(c.top)} vs ${fighterLabel(c.bottom)}`
}

/**
 * Importe un tirage dans une session existante en conservant les tatamis déjà créés.
 * Les nouveaux combats arrivent non assignés (répartition ensuite sur Combats).
 */
export function mergeTirageIntoCombatSession(
  existing: CombatSession | null,
  result: TirageResult
): CombatSession {
  const draft = combatSessionFromTirage(result)
  if (!existing?.tatamis.length) return draft
  return {
    ...draft,
    id: existing.id,
    tatamis: existing.tatamis.map((t) => ({ ...t })),
    confirmedAt: null,
    updatedAt: new Date().toISOString()
  }
}

/**
 * Aplatit un TirageResult en combats gérables (tous les tours),
 * avec liens de progression pour le suivi d’évolution.
 */
export function combatSessionFromTirage(result: TirageResult): CombatSession {
  const now = new Date().toISOString()
  const session = createEmptyCombatSession()
  session.sourceTirageAt = result.generatedAt || now
  session.updatedAt = now

  const combats: ManagedCombat[] = []

  for (const pool of result.pools) {
    const category = formatTirageCategoryName(pool.category)
    const poolKey = `${pool.sex}|${category}|${pool.weightClassId || 'open'}`
    const weightPart = pool.weightLabel?.trim() ? ` · ${pool.weightLabel.trim()}` : ''
    const poolLabel = `${pool.sexLabel} · ${category}${weightPart}`
    const rounds = pool.bracket.rounds

    for (let r = 0; r < rounds.length; r++) {
      const round = rounds[r]!
      for (let mi = 0; mi < round.length; mi++) {
        const match = round[mi]!
        const top = fighterRef(match.top.fighter)
        const bottom = fighterRef(match.bottom.fighter)
        const hasBoth = Boolean(top && bottom)
        const hasOne = Boolean(top || bottom)
        let status: CombatStatus = 'pending'
        let winnerId: string | null = null
        if (match.bye && hasOne && !hasBoth) {
          status = 'completed'
          winnerId = top?.id ?? bottom?.id ?? null
        } else if (hasBoth) {
          status = 'ready'
        }

        let feedsInto: ManagedCombat['feedsInto'] = null
        if (r + 1 < rounds.length) {
          const nextMatch = rounds[r + 1]![Math.floor(mi / 2)]
          if (nextMatch) {
            feedsInto = {
              combatId: `${poolKey}::${nextMatch.id}`,
              slot: mi % 2 === 0 ? 'top' : 'bottom'
            }
          }
        }

        combats.push({
          id: `${poolKey}::${match.id}`,
          matchId: match.id,
          label: match.label,
          round: match.round,
          matchIndex: match.matchIndex,
          poolKey,
          poolLabel,
          sex: pool.sex,
          category,
          weightLabel: pool.weightLabel || '',
          top,
          bottom,
          bye: match.bye,
          tatamiId: null,
          orderOnTatami: 0,
          status,
          winnerId,
          feedsInto,
          updatedAt: now
        })
      }
    }
  }

  session.combats = combats
  return session
}

/** Place le vainqueur dans le combat suivant et met à jour le statut. */
export function applyCombatWinner(
  session: CombatSession,
  combatId: string,
  winnerId: string
): CombatSession {
  const now = new Date().toISOString()
  const combats = session.combats.map((c) => ({ ...c }))
  const idx = combats.findIndex((c) => c.id === combatId)
  if (idx < 0) return session
  const combat = combats[idx]!
  const winner =
    combat.top?.id === winnerId ? combat.top : combat.bottom?.id === winnerId ? combat.bottom : null
  if (!winner) return session

  combat.status = 'completed'
  combat.winnerId = winnerId
  combat.updatedAt = now

  if (combat.feedsInto) {
    const nextIdx = combats.findIndex((c) => c.id === combat.feedsInto!.combatId)
    if (nextIdx >= 0) {
      const next = { ...combats[nextIdx]! }
      if (combat.feedsInto.slot === 'top') next.top = winner
      else next.bottom = winner
      const hasBoth = Boolean(next.top && next.bottom)
      const hasOne = Boolean(next.top || next.bottom)
      if (hasBoth) {
        next.status = next.status === 'completed' ? 'completed' : 'ready'
        next.bye = false
      } else if (hasOne && next.status === 'pending') {
        next.status = 'pending'
      }
      next.updatedAt = now
      combats[nextIdx] = next
    }
  }

  combats[idx] = combat
  return { ...session, combats, updatedAt: now }
}

/** Répartit les combats « ready » du 1er tour (et byes) sur les tatamis en round-robin. */
export function distributeCombatsAcrossTatamis(session: CombatSession): CombatSession {
  const tatamis = session.tatamis
  if (tatamis.length === 0) return session
  const now = new Date().toISOString()
  const assignable = session.combats
    .filter((c) => c.round === 0 && (c.status === 'ready' || c.status === 'completed'))
    .sort((a, b) => a.poolLabel.localeCompare(b.poolLabel, 'fr') || a.matchIndex - b.matchIndex)

  const counts = new Map<string, number>()
  for (const t of tatamis) counts.set(t.id, 0)

  const assignedIds = new Set<string>()
  const updates = new Map<string, { tatamiId: string; orderOnTatami: number }>()

  assignable.forEach((c, i) => {
    const tatami = tatamis[i % tatamis.length]!
    const order = counts.get(tatami.id) ?? 0
    counts.set(tatami.id, order + 1)
    updates.set(c.id, { tatamiId: tatami.id, orderOnTatami: order })
    assignedIds.add(c.id)
  })

  return {
    ...session,
    updatedAt: now,
    combats: session.combats.map((c) => {
      const u = updates.get(c.id)
      if (!u) {
        if (c.round === 0) return { ...c, tatamiId: null, orderOnTatami: 0, updatedAt: now }
        return c
      }
      return { ...c, ...u, updatedAt: now }
    })
  }
}
