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
  borderBottom
}: {
  fighter: TirageFighter | null
  borderBottom?: boolean
}) {
  return (
    <div
      className={`min-w-0 px-2 py-1 ${borderBottom ? 'border-b border-judo-navy/15' : ''}`}
    >
      <div className="text-[11px] font-bold leading-snug text-judo-navy break-words">
        {slotName(fighter)}
      </div>
      {fighter ? (
        <div className="mt-0.5 text-[9px] leading-tight text-muted-foreground break-words">
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
 * Couleurs app : navy / rouge / fond clair.
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
  const matchBlockH = 84
  const matchGap = 14
  const firstColHeight = firstRound.length * (matchBlockH + matchGap) - matchGap

  return (
    <div className="overflow-x-auto">
      {title ? (
        <p className="mb-3 px-1 text-sm font-medium text-judo-navy">{title}</p>
      ) : null}
      <div
        className="inline-flex min-w-full items-stretch gap-0 px-2 py-3"
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
    </div>
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

  return (
    <div className="relative flex flex-col justify-around" style={{ height: colH, width: colW }}>
      {matches.map((m) => (
        <div key={m.id} className="flex items-center justify-center" style={{ height: slotH }}>
          <MatchCard match={m} wide={roundIdx === 0} />
        </div>
      ))}
    </div>
  )
}

function MatchCard({ match, wide }: { match: BracketMatch; wide?: boolean }) {
  return (
    <div
      className={`flex overflow-hidden rounded border border-judo-navy/25 bg-white shadow-sm ${
        wide ? 'w-[250px]' : 'w-[230px]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <SlotLines fighter={match.top.fighter} borderBottom />
        <SlotLines fighter={match.bottom.fighter} />
      </div>
      <div className="flex w-[68px] shrink-0 items-center justify-center bg-judo-navy px-1 text-center text-[10px] font-semibold leading-tight text-white">
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
  const pairs = fromCount / 2
  const pairH = colH / pairs

  return (
    <div className="relative" style={{ width: 72, height: colH }}>
      {Array.from({ length: pairs }, (_, i) => {
        const topY = i * pairH + pairH * 0.25
        const botY = i * pairH + pairH * 0.75
        const midY = i * pairH + pairH * 0.5
        return (
          <svg
            key={i}
            className="absolute inset-0 overflow-visible"
            width={72}
            height={colH}
            aria-hidden
          >
            <path
              d={`M 0 ${topY} H 32 V ${botY} H 0 M 32 ${midY} H 72`}
              fill="none"
              stroke="#0B1F3A"
              strokeWidth={1.25}
            />
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
  finalMatch?: BracketMatch
}) {
  const colH = firstRoundCount * (matchBlockH + matchGap) - matchGap
  const midY = colH / 2

  return (
    <div className="relative" style={{ width: 120, height: colH }}>
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
        <div className="text-xs font-semibold text-judo-red">Vainqueur</div>
      </div>
    </div>
  )
}
