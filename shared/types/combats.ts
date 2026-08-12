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
  /** Mot de passe JVac-Chrono (généré à la confirmation). */
  password?: string
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

const TATAMI_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Mot de passe court, lisible, pour JVac-Chrono. */
export function createTatamiPassword(): string {
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += TATAMI_PASSWORD_ALPHABET[Math.floor(Math.random() * TATAMI_PASSWORD_ALPHABET.length)]
  }
  return s
}

export function ensureTatamiPasswords(session: CombatSession): CombatSession {
  return {
    ...session,
    tatamis: session.tatamis.map((t, i) => ({
      ...t,
      name: t.name.trim() || `Tatami ${i + 1}`,
      password: t.password?.trim() || createTatamiPassword()
    })),
    updatedAt: new Date().toISOString()
  }
}

export function tatamiDisplayLabel(_tatami: Tatami, index: number): string {
  return `Tatami-${index + 1}`
}

/** Au moins un judoka présent (les cases vides restent en base, non affichées). */
export function hasAtLeastOneJudoka(c: ManagedCombat): boolean {
  return Boolean(c.top || c.bottom)
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
 * Importe un tirage dans une session existante en conservant les tatamis déjà créés,
 * puis répartit les combats des 1er et 2e tours pour qu’aucun tatami ne reste vide
 * (si le nombre de combats le permet).
 */
export function mergeTirageIntoCombatSession(
  existing: CombatSession | null,
  result: TirageResult
): CombatSession {
  const draft = combatSessionFromTirage(result)
  if (!existing?.tatamis.length) return draft
  const merged: CombatSession = {
    ...draft,
    id: existing.id,
    tatamis: existing.tatamis.map((t) => ({ ...t })),
    confirmedAt: null,
    updatedAt: new Date().toISOString()
  }
  return distributeCombatsAcrossTatamis(merged)
}

/** Tours placés sur les tatamis à l’import / répartition (1er + 2e). */
export const TATAMI_SCHEDULE_ROUNDS = [0, 1] as const

/** Combat du 1er ou 2e tour à placer sur un tatami (uniquement s’il y a un judoka). */
export function isCombatSchedulableOnTatami(c: ManagedCombat): boolean {
  if (!hasAtLeastOneJudoka(c)) return false
  if (c.round === 0) return c.status === 'ready' || c.status === 'completed'
  if (c.round === 1) return true
  return false
}

/** Combats des 1er et 2e tours pouvant être placés sur un tatami. */
export function countSchedulableOnTatamis(session: CombatSession): number {
  return session.combats.filter(isCombatSchedulableOnTatami).length
}

/** @deprecated Utiliser countSchedulableOnTatamis. */
export function countFirstRoundAssignable(session: CombatSession): number {
  return countSchedulableOnTatamis(session)
}

/** Tatamis sans aucun combat (avec judoka) assigné. */
export function listTatamisWithoutCombats(session: CombatSession): Tatami[] {
  return session.tatamis.filter(
    (t) => !session.combats.some((c) => c.tatamiId === t.id && hasAtLeastOneJudoka(c))
  )
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
      if (hasAtLeastOneJudoka(next) && !next.tatamiId && combat.tatamiId) {
        const maxOrder = combats
          .filter((x) => x.tatamiId === combat.tatamiId)
          .reduce((m, x) => Math.max(m, x.orderOnTatami), -1)
        next.tatamiId = combat.tatamiId
        next.orderOnTatami = maxOrder + 1
      }
      next.updatedAt = now
      combats[nextIdx] = next
    }
  }

  combats[idx] = combat
  return { ...session, combats, updatedAt: now }
}

/**
 * Répartit et classe les combats des 1er et 2e tours sur les tatamis disponibles.
 * Ordre sur chaque tatami : 1er tour puis 2e tour (par poule / index).
 * Si assez de combats, chaque tatami reçoit au moins un combat.
 */
export function distributeCombatsAcrossTatamis(session: CombatSession): CombatSession {
  const tatamis = session.tatamis
  if (tatamis.length === 0) return session
  const now = new Date().toISOString()

  const sortSchedulable = (a: ManagedCombat, b: ManagedCombat): number =>
    a.round - b.round ||
    a.poolLabel.localeCompare(b.poolLabel, 'fr') ||
    a.matchIndex - b.matchIndex

  const round1 = session.combats
    .filter(
      (c) =>
        c.round === 0 &&
        hasAtLeastOneJudoka(c) &&
        (c.status === 'ready' || c.status === 'completed')
    )
    .sort(sortSchedulable)
  const round2 = session.combats
    .filter((c) => c.round === 1 && hasAtLeastOneJudoka(c))
    .sort(sortSchedulable)
  const assignable = [...round1, ...round2]

  const byTatami = new Map<string, ManagedCombat[]>()
  for (const t of tatamis) byTatami.set(t.id, [])

  const pickLeastLoaded = (): string => {
    let bestId = tatamis[0]!.id
    let bestCount = byTatami.get(bestId)?.length ?? 0
    for (const t of tatamis) {
      const n = byTatami.get(t.id)?.length ?? 0
      if (n < bestCount) {
        bestId = t.id
        bestCount = n
      }
    }
    return bestId
  }

  // 1) Garantir un combat par tatami (priorité 1er tour)
  let cursor = 0
  for (const tatami of tatamis) {
    if (cursor >= assignable.length) break
    const c = assignable[cursor]!
    byTatami.get(tatami.id)!.push(c)
    cursor += 1
  }
  // 2) Répartir le reste (suite 1er tour puis 2e tour) sur le tatami le moins chargé
  while (cursor < assignable.length) {
    const c = assignable[cursor]!
    byTatami.get(pickLeastLoaded())!.push(c)
    cursor += 1
  }

  const updates = new Map<string, { tatamiId: string; orderOnTatami: number }>()
  for (const tatami of tatamis) {
    const list = (byTatami.get(tatami.id) ?? []).slice().sort(sortSchedulable)
    list.forEach((c, order) => {
      updates.set(c.id, { tatamiId: tatami.id, orderOnTatami: order })
    })
  }

  return {
    ...session,
    updatedAt: now,
    combats: session.combats.map((c) => {
      const u = updates.get(c.id)
      if (!u) {
        // Tours 1–2 non retenus / tours suivants : pas d’affectation ici
        if (c.round === 0 || c.round === 1) {
          return { ...c, tatamiId: null, orderOnTatami: 0, updatedAt: now }
        }
        return c
      }
      return { ...c, ...u, updatedAt: now }
    })
  }
}
