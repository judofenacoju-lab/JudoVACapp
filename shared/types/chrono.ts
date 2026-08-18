import type {
  CombatFighterRef,
  CombatSession,
  CombatSessionKind,
  CombatStatus,
  ManagedCombat,
  TeamWinMethod
} from '@shared/types/combats'
import { resolveCombatPhase } from '@shared/types/combats'
import type { CombatPhase } from '@shared/utils/combat-phase'

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
  winMethod?: TeamWinMethod
  goldenScore?: boolean
  kind?: CombatSessionKind
  teamMatchLabel?: string
  homeClub?: string
  awayClub?: string
  phase?: CombatPhase
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

export function toChronoCombat(c: ManagedCombat, session?: CombatSession | null): ChronoCombat {
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
    winMethod: c.winMethod,
    goldenScore: c.goldenScore,
    kind: c.kind === 'team' ? 'team' : 'individual',
    teamMatchLabel: c.teamMatchLabel,
    homeClub: c.homeClub,
    awayClub: c.awayClub,
    phase: resolveCombatPhase(c, session)
  }
}
