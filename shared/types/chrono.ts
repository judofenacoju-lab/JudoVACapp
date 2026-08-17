import type {
  CombatFighterRef,
  CombatSessionKind,
  CombatStatus,
  ManagedCombat
} from '@shared/types/combats'

/** Combat exposé à JVac-Chrono (sans cases vides). */
export interface ChronoCombat {
  id: string
  label: string
  round: number
  matchIndex: number
  poolLabel: string
  orderOnTatami: number
  status: CombatStatus
  bye: boolean
  top: CombatFighterRef | null
  bottom: CombatFighterRef | null
  topSubstitute?: CombatFighterRef | null
  bottomSubstitute?: CombatFighterRef | null
  winnerId: string | null
  kind?: CombatSessionKind
  teamMatchLabel?: string
  homeClub?: string
  awayClub?: string
}

export interface ChronoConnectResponse {
  ok: true
  tatamiId: string
  tatamiName: string
  tatamiIndex: number
  sessionId: string
  confirmedAt: string | null
  kind: CombatSessionKind
  combats: ChronoCombat[]
}

export interface ChronoErrorResponse {
  ok: false
  error: string
}

export function toChronoCombat(c: ManagedCombat): ChronoCombat {
  return {
    id: c.id,
    label: c.label,
    round: c.round,
    matchIndex: c.matchIndex,
    poolLabel: c.poolLabel,
    orderOnTatami: c.orderOnTatami,
    status: c.status,
    bye: c.bye,
    top: c.top,
    bottom: c.bottom,
    topSubstitute: c.topSubstitute ?? null,
    bottomSubstitute: c.bottomSubstitute ?? null,
    winnerId: c.winnerId,
    kind: c.kind === 'team' ? 'team' : 'individual',
    teamMatchLabel: c.teamMatchLabel,
    homeClub: c.homeClub,
    awayClub: c.awayClub
  }
}
