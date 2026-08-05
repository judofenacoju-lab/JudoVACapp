import type { BracketMatch, BracketTree, TirageFighter } from '@shared/utils/tirage'

function slotLabel(fighter: TirageFighter | null, _empty: boolean): string {
  if (fighter) return fighter.name
  return '...'
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
  const matchBlockH = 56
  const matchGap = 12
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
              totalRounds={bracket.rounds.length}
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
  totalRounds: number
  firstRoundCount: number
  matchBlockH: number
  matchGap: number
}) {
  const colH = firstRoundCount * (matchBlockH + matchGap) - matchGap
  const slotH = colH / matches.length

  return (
    <div className="relative flex flex-col justify-around" style={{ height: colH, width: roundIdx === 0 ? 220 : 72 }}>
      {matches.map((m) => (
        <div
          key={m.id}
          className="flex items-center justify-center"
          style={{ height: slotH }}
        >
          {roundIdx === 0 ? <FirstRoundMatch match={m} /> : <LaterRoundBadge match={m} />}
        </div>
      ))}
    </div>
  )
}

function FirstRoundMatch({ match }: { match: BracketMatch }) {
  return (
    <div className="flex w-[210px] overflow-hidden rounded border border-judo-navy/25 bg-white shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="border-b border-judo-navy/15 px-2 py-1.5 text-xs font-medium text-judo-navy truncate">
          {slotLabel(match.top.fighter, match.top.empty)}
        </div>
        <div className="px-2 py-1.5 text-xs font-medium text-judo-navy truncate">
          {slotLabel(match.bottom.fighter, match.bottom.empty)}
        </div>
      </div>
      <div className="flex w-[72px] shrink-0 items-center justify-center bg-judo-navy px-1 text-center text-[10px] font-semibold leading-tight text-white">
        {match.label}
      </div>
    </div>
  )
}

function LaterRoundBadge({ match }: { match: BracketMatch }) {
  return (
    <div className="flex h-9 min-w-[52px] items-center justify-center rounded border border-judo-navy/30 bg-judo-mist px-2 text-xs font-semibold text-judo-navy">
      {match.label}
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
    <div className="relative" style={{ width: 88, height: colH }}>
      {Array.from({ length: pairs }, (_, i) => {
        const topY = i * pairH + pairH * 0.25
        const botY = i * pairH + pairH * 0.75
        const midY = i * pairH + pairH * 0.5
        return (
          <svg
            key={i}
            className="absolute inset-0 overflow-visible"
            width={88}
            height={colH}
            aria-hidden
          >
            <path
              d={`M 0 ${topY} H 40 V ${botY} H 0 M 40 ${midY} H 88`}
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
}) {
  const colH = firstRoundCount * (matchBlockH + matchGap) - matchGap
  const midY = colH / 2
  return (
    <div className="relative" style={{ width: 100, height: colH }}>
      <svg width={100} height={colH} className="absolute inset-0" aria-hidden>
        <path
          d={`M 0 ${midY} H 70`}
          fill="none"
          stroke="#0B1F3A"
          strokeWidth={1.25}
        />
      </svg>
      <div
        className="absolute left-[72px] -translate-y-1/2 whitespace-nowrap text-xs font-semibold text-judo-red"
        style={{ top: midY }}
      >
        Vainqueur
      </div>
    </div>
  )
}
