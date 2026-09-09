import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TirageResult } from '@shared/utils/tirage'
import type { TeamTirageResult } from '@shared/utils/team-tirage'
import { getActiveBrandName } from '@shared/utils/branding'

export interface CeremonyPair {
  white: string
  blue: string
}

const DURATION_MS = 10_000
const SHUFFLE_UNTIL_MS = 5_500
const REVEAL_UNTIL_MS = 9_400
const MAX_ORBIT = 12
const MAX_PAIRS = 6

export function pairsFromIndividualTirage(result: TirageResult): CeremonyPair[] {
  const pairs: CeremonyPair[] = []
  for (const pool of result.pools) {
    for (const m of pool.bracket.rounds[0] ?? []) {
      const white = m.top.fighter?.name?.trim() || '…'
      const blue = m.bottom.fighter?.name?.trim() || '…'
      if (white === '…' && blue === '…') continue
      pairs.push({ white, blue })
    }
  }
  return pairs
}

export function namesFromIndividualTirage(result: TirageResult): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const pool of result.pools) {
    for (const round of pool.bracket.rounds) {
      for (const m of round) {
        for (const slot of [m.top.fighter, m.bottom.fighter]) {
          const n = slot?.name?.trim()
          if (!n || seen.has(n)) continue
          seen.add(n)
          names.push(n)
        }
      }
    }
  }
  return names
}

export function pairsFromTeamTirage(result: TeamTirageResult): CeremonyPair[] {
  return (result.session.teamMatches ?? [])
    .filter((m) => m.round === 0)
    .map((m) => ({
      white: m.homeClub?.trim() || '…',
      blue: m.awayClub?.trim() || '…'
    }))
    .filter((p) => p.white !== 'Bye' && p.blue !== 'Bye')
}

export function namesFromTeamTirage(result: TeamTirageResult): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const p of pairsFromTeamTirage(result)) {
    for (const n of [p.white, p.blue]) {
      if (!n || n === '…' || n === 'Bye' || seen.has(n)) continue
      seen.add(n)
      names.push(n)
    }
  }
  return names
}

export function TirageCeremonyModal({
  open,
  kind,
  names,
  pairs,
  durationMs = DURATION_MS,
  onFinished
}: {
  open: boolean
  kind: 'individual' | 'team'
  names: string[]
  pairs: CeremonyPair[]
  durationMs?: number
  onFinished: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const [orbit, setOrbit] = useState<string[]>([])
  const finishedRef = useRef(false)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  const displayNames = useMemo(() => {
    const unique = names.filter(Boolean)
    if (unique.length >= 4) return unique
    return unique.length > 0 ? unique : ['Tirage', 'en cours']
  }, [names])

  const displayPairs = pairs.slice(0, MAX_PAIRS)
  const extraPairs = Math.max(0, pairs.length - displayPairs.length)

  useEffect(() => {
    if (!open) {
      setElapsed(0)
      finishedRef.current = false
      return
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = now - start
      setElapsed(t)
      if (t >= durationMs) {
        if (!finishedRef.current) {
          finishedRef.current = true
          onFinishedRef.current()
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = prevOverflow
    }
  }, [open, durationMs])

  useEffect(() => {
    if (!open) return
    const shuffle = () => {
      const copy = [...displayNames]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const a = copy[i]!
        copy[i] = copy[j]!
        copy[j] = a
      }
      setOrbit(copy.slice(0, MAX_ORBIT))
    }
    shuffle()
    if (elapsed >= SHUFFLE_UNTIL_MS) return
    const id = window.setInterval(shuffle, 90)
    return () => window.clearInterval(id)
  }, [open, displayNames, elapsed >= SHUFFLE_UNTIL_MS])

  if (!open) return null

  const progress = Math.min(1, elapsed / durationMs)
  const remainingSec = Math.max(0, Math.ceil((durationMs - elapsed) / 1000))
  const revealing = elapsed >= SHUFFLE_UNTIL_MS
  const revealSpan = Math.max(1, REVEAL_UNTIL_MS - SHUFFLE_UNTIL_MS)
  const revealedCount = revealing
    ? Math.min(
        displayPairs.length,
        Math.max(1, Math.ceil(((elapsed - SHUFFLE_UNTIL_MS) / revealSpan) * displayPairs.length))
      )
    : 0
  const spin = (elapsed / 1000) * 70
  const shownOrbit = orbit.length > 0 ? orbit : displayNames.slice(0, MAX_ORBIT)
  const nOrbit = Math.max(1, shownOrbit.length)

  return createPortal(
    <div
      className="tirage-ceremony fixed inset-0 z-[200] flex flex-col bg-white text-judo-navy"
      role="dialog"
      aria-modal="true"
      aria-label="Tirage au sort"
    >
      <div className="h-1.5 w-full bg-slate-100">
        <div
          className="h-full bg-judo-red transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <header className="flex items-center justify-between gap-3 border-b-4 border-judo-red bg-white px-6 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-judo-red">
            Official draw
          </p>
          <h2 className="font-display text-2xl font-bold tracking-wide text-judo-navy sm:text-3xl">
            TIRAGE AU SORT
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-widest text-judo-navy/60">
              {getActiveBrandName()}
            </p>
            <p className="text-sm font-bold uppercase text-judo-navy">
              {kind === 'team' ? 'Par équipe' : 'Individuel'}
            </p>
          </div>
          <div className="flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-judo-red text-judo-red">
            <span className="font-display text-xl font-bold leading-none">{remainingSec}</span>
            <span className="text-[9px] font-semibold uppercase tracking-wider">sec</span>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 py-6">
        <div className="tirage-ceremony-ring pointer-events-none absolute inset-0 opacity-40" />
        {!revealing ? (
          <div className="relative h-[280px] w-[280px] sm:h-[340px] sm:w-[340px]">
            <div className="absolute inset-[22%] rounded-full border-2 border-judo-navy/15" />
            <div className="absolute inset-[38%] flex items-center justify-center rounded-full border-4 border-judo-red bg-white shadow-sm">
              <span className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-judo-red">
                Draw
              </span>
            </div>
            {shownOrbit.map((name, i) => {
              const angle = (i / nOrbit) * 360 + spin
              return (
                <div
                  key={`${name}-${i}`}
                  className="absolute left-1/2 top-1/2 w-36 -translate-x-1/2 -translate-y-1/2 text-center"
                  style={{
                    transform: `rotate(${angle}deg) translateY(-118px) rotate(${-angle}deg)`
                  }}
                >
                  <span className="inline-block max-w-full truncate rounded-full border border-judo-navy/15 bg-white px-2 py-1 text-[11px] font-semibold shadow-sm sm:text-xs">
                    {name}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex w-full max-w-2xl flex-col gap-2">
            <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-judo-red">
              Rencontres
            </p>
            {displayPairs.slice(0, revealedCount).map((p, i) => (
              <div
                key={`${p.white}-${p.blue}-${i}`}
                className="tirage-ceremony-lock grid grid-cols-[1fr_auto_1fr] items-stretch overflow-hidden rounded-lg border border-judo-navy/20 bg-white shadow-sm"
              >
                <div className="bg-white px-3 py-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Blanc</p>
                  <p className="truncate text-sm font-bold text-judo-navy">{p.white}</p>
                </div>
                <div className="flex items-center bg-judo-navy px-2.5 text-[11px] font-extrabold text-white">
                  VS
                </div>
                <div className="bg-blue-700 px-3 py-2.5 text-white">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-white/70">Bleu</p>
                  <p className="truncate text-sm font-bold">{p.blue}</p>
                </div>
              </div>
            ))}
            {revealedCount >= displayPairs.length && extraPairs > 0 ? (
              <p className="pt-1 text-center text-xs text-judo-navy/60">
                + {extraPairs} rencontre{extraPairs > 1 ? 's' : ''}
              </p>
            ) : null}
          </div>
        )}
        <p className="mt-8 text-xs font-medium uppercase tracking-[0.2em] text-judo-navy/45">
          {revealing ? 'Verrouillage des rencontres' : 'Mélange des participants'}
        </p>
      </div>
      <div className="flex h-3 shrink-0">
        <div className="flex-1 border-t border-slate-200 bg-white" />
        <div className="flex-1 bg-blue-700" />
      </div>
    </div>,
    document.body
  )
}
