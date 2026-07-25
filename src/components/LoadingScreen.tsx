import { useEffect, useState } from 'react'
import brandLogo from '@/assets/brand-logo.png'

const DURATION_MS = 900
const RING_SIZE = 120
const RING_RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export const LOADING_DURATION_MS = DURATION_MS

export function LoadingScreen() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now()
    let frame = 0
    let cancelled = false

    const tick = (now: number) => {
      if (cancelled) return
      const t = Math.min(1, (now - start) / DURATION_MS)
      setProgress(t)
      if (t < 1) {
        frame = requestAnimationFrame(tick)
      }
    }

    try {
      frame = requestAnimationFrame(tick)
    } catch {
      setProgress(1)
    }
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [])

  const strokeOffset = CIRCUMFERENCE * (1 - progress)

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-white"
      style={{ minHeight: '100vh', width: '100%' }}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
        <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }} aria-hidden>
          <svg
            className="absolute inset-0 -rotate-90"
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="4"
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="#C8102E"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeOffset}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <img
              src={brandLogo}
              alt="JudoVACapp"
              className="h-[72px] w-[72px] rounded-full object-cover"
            />
          </div>
        </div>
        <p className="text-sm font-medium text-[#0B1F3A]">Chargement JudoVACapp…</p>
      </div>

      <footer className="w-full bg-[#e8e8e8] py-3 text-center">
        <p className="text-sm font-normal text-[#4a4a4a]">Développé par Initiative Judo</p>
      </footer>
    </div>
  )
}
