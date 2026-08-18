import { combatPhaseLabel } from '@shared/utils/combat-phase'
import {
  formatFighterMeta,
  type BracketMatch,
  type BracketTree,
  type TirageFighter
} from '@shared/utils/tirage'

function slotName(fighter: TirageFighter | null): string {
  return fighter ? fighter.name : '...'
}

function SlotLines({
  fighter,
  tone,
  borderBottom
}: {
  fighter: TirageFighter | null
  tone: 'white' | 'blue'
  borderBottom?: boolean
}) {
  const isBlue = tone === 'blue'
  return (
    <div
      className={`min-w-0 px-2 py-1 ${borderBottom ? 'border-b border-judo-navy/20' : ''} ${
        isBlue ? 'bg-blue-700 text-white' : 'bg-white text-judo-navy'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`shrink-0 text-[8px] font-extrabold tracking-wide ${
            isBlue ? 'text-white/80' : 'text-slate-400'
          }`}
        >
          {isBlue ? 'BLEU' : 'BLANC'}
        </span>
        <div className="min-w-0 text-[11px] font-bold leading-snug break-words">{slotName(fighter)}</div>
      </div>
      {fighter ? (
        <div
          className={`mt-0.5 text-[9px] leading-tight break-words ${
            isBlue ? 'text-white/75' : 'text-muted-foreground'
          }`}
        >
          {formatFighterMeta(fighter)}
        </div>
      ) : (
        <div className="h-[11px]" aria-hidden />
      )}
    </div>
  )
}

/**
 * Grille à élimination directe (style tableau de combat judo).
 * BLANC au-dessus, BLEU en bas.
 */
export function CombatBracket({
  bracket,
  title
}: {
  bracket: BracketTree
  title?: string
}) {
  if (!bracket.rounds.length) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Aucun combat dans ce groupe.</p>
  }

  const firstRound = bracket.rounds[0]!
  const matchBlockH = 92
  const matchGap = 14
  const firstColHeight = firstRound.length * (matchBlockH + matchGap) - matchGap
  const repechage = bracket.repechage ?? []
  const bronze = bracket.bronze ?? []

  const hasRepechage = repechage.length > 0 || bronze.length > 0

  return (
    <div className="overflow-x-auto">
      {title ? (
        <p className="mb-3 px-1 text-sm font-medium text-judo-navy">{title}</p>
      ) : null}
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        <div
          className="inline-flex items-stretch gap-0 px-2 py-3"
          style={{ minHeight: firstColHeight + 24 }}
        >
          {bracket.rounds.map((round, roundIdx) => (
            <div key={`round-${roundIdx}`} className="flex items-stretch">
              <RoundColumn
                matches={round}
                roundIdx={roundIdx}
                firstRoundCount={firstRound.length}
                matchBlockH={matchBlockH}
                matchGap={matchGap}
              />
              {roundIdx < bracket.rounds.length - 1 ? (
                <ConnectorColumn
                  fromCount={round.length}
                  firstRoundCount={firstRound.length}
                  matchBlockH={matchBlockH}
                  matchGap={matchGap}
                />
              ) : (
                <WinnerTail
                  firstRoundCount={firstRound.length}
                  matchBlockH={matchBlockH}
                  matchGap={matchGap}
                />
              )}
            </div>
          ))}
        </div>
        {hasRepechage ? (
          <RepechageMiniGrid repechage={repechage} bronze={bronze} />
        ) : null}
      </div>
    </div>
  )
}

/** Petite grille : 2 repêchages (perdants des quarts) → 2 finales de bronze. */
function RepechageMiniGrid({
  repechage,
  bronze
}: {
  repechage: BracketMatch[]
  bronze: BracketMatch[]
}) {
  const pairs = Math.max(repechage.length, bronze.length, 1)
  return (
    <aside className="mx-2 mb-3 min-w-[320px] rounded-lg border border-judo-red/25 bg-white px-3 py-3 shadow-sm xl:mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-judo-red">Repêchage</p>
      <p className="mb-3 mt-1 text-[10px] leading-snug text-muted-foreground">
        Perdants des quarts entre eux, puis gagnants contre les perdants de demi-finale.
      </p>
      <div className="mb-1 grid grid-cols-[1fr_28px_1fr] gap-x-0 text-center text-[9px] font-semibold uppercase tracking-wide text-judo-navy">
        <span>Repêchage</span>
        <span />
        <span>Bronze</span>
      </div>
      <div className="grid grid-cols-[1fr_28px_1fr] items-center gap-y-3">
        {Array.from({ length: pairs }, (_, i) => (
          <RepechagePair
            key={repechage[i]?.id ?? bronze[i]?.id ?? `pair-${i}`}
            left={repechage[i] ?? null}
            right={bronze[i] ?? null}
          />
        ))}
      </div>
    </aside>
  )
}

function RepechagePair({ left, right }: { left: BracketMatch | null; right: BracketMatch | null }) {
  return (
    <>
      <div className="flex justify-center">{left ? <MatchCard match={left} compact /> : null}</div>
      <div className="h-px bg-judo-navy" aria-hidden />
      <div className="flex justify-center">{right ? <MatchCard match={right} compact /> : null}</div>
    </>
  )
}

function RoundColumn({
  matches,
  roundIdx,
  firstRoundCount,
  matchBlockH,
  matchGap
}: {
  matches: BracketMatch[]
  roundIdx: number
  firstRoundCount: number
  matchBlockH: number
  matchGap: number
}) {
  const colH = firstRoundCount * (matchBlockH + matchGap) - matchGap
  const slotH = colH / matches.length
  const colW = roundIdx === 0 ? 260 : 240
  const phase = combatPhaseLabel(matches[0]?.phase)

  return (
    <div className="relative flex flex-col" style={{ height: colH + 22, width: colW }}>
      {phase ? (
        <div className="mb-1 h-[18px] text-center text-[10px] font-semibold uppercase tracking-wide text-judo-red">
          {phase}
        </div>
      ) : (
        <div className="mb-1 h-[18px]" />
      )}
      <div className="relative flex flex-col justify-around" style={{ height: colH, width: colW }}>
        {matches.map((m) => (
          <div key={m.id} className="flex items-center justify-center" style={{ height: slotH }}>
            <MatchCard match={m} wide={roundIdx === 0} />
          </div>
        ))}
      </div>
    </div>
  )
}

function MatchCard({
  match,
  wide,
  compact
}: {
  match: BracketMatch
  wide?: boolean
  compact?: boolean
}) {
  return (
    <div
      className={`flex overflow-hidden rounded border border-judo-navy/25 bg-white shadow-sm ${
        compact ? 'w-[200px]' : wide ? 'w-[250px]' : 'w-[230px]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <SlotLines fighter={match.top.fighter} tone="white" borderBottom />
        <SlotLines fighter={match.bottom.fighter} tone="blue" />
      </div>
      <div className="flex w-[68px] shrink-0 flex-col items-center justify-center bg-judo-navy px-1 text-center text-[10px] font-semibold leading-tight text-white">
        {match.label}
      </div>
    </div>
  )
}

function ConnectorColumn({
  fromCount,
  firstRoundCount,
  matchBlockH,
  matchGap
}: {
  fromCount: number
  firstRoundCount: number
  matchBlockH: number
  matchGap: number
}) {
  const colH = firstRoundCount * (matchBlockH + matchGap) - matchGap
  const destCount = Math.ceil(fromCount / 2)
  const fromSlotH = colH / fromCount

  return (
    <div className="relative mt-[22px]" style={{ width: 72, height: colH }}>
      {Array.from({ length: destCount }, (_, p) => {
        const i0 = p * 2
        const i1 = p * 2 + 1
        const y0 = i0 * fromSlotH + fromSlotH / 2
        if (i1 < fromCount) {
          const y1 = i1 * fromSlotH + fromSlotH / 2
          const midY = (y0 + y1) / 2
          return (
            <svg
              key={p}
              className="absolute inset-0 overflow-visible"
              width={72}
              height={colH}
              aria-hidden
            >
              <path
                d={`M 0 ${y0} H 32 V ${y1} H 0 M 32 ${midY} H 72`}
                fill="none"
                stroke="#0B1F3A"
                strokeWidth={1.25}
              />
            </svg>
          )
        }
        return (
          <svg
            key={p}
            className="absolute inset-0 overflow-visible"
            width={72}
            height={colH}
            aria-hidden
          >
            <path d={`M 0 ${y0} H 72`} fill="none" stroke="#0B1F3A" strokeWidth={1.25} />
          </svg>
        )
      })}
    </div>
  )
}

function WinnerTail({
  firstRoundCount,
  matchBlockH,
  matchGap
}: {
  firstRoundCount: number
  matchBlockH: number
  matchGap: number
}) {
  const colH = firstRoundCount * (matchBlockH + matchGap) - matchGap
  const midY = colH / 2

  return (
    <div className="relative mt-[22px]" style={{ width: 120, height: colH }}>
      <svg width={120} height={colH} className="absolute inset-0" aria-hidden>
        <path
          d={`M 0 ${midY} H 48`}
          fill="none"
          stroke="#0B1F3A"
          strokeWidth={1.25}
        />
      </svg>
      <div
        className="absolute left-[52px] max-w-[68px] -translate-y-1/2"
        style={{ top: midY }}
      >
        <div className="text-xs font-semibold text-judo-red">Finale Or</div>
      </div>
    </div>
  )
}
