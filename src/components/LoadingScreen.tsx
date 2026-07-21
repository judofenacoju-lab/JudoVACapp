import { useEffect, useState } from 'react'
import brandLogo from '@/assets/brand-logo.png'

const DURATION_MS = 1200
const RING_SIZE = 120
const RING_RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export const LOADING_DURATION_MS = DURATION_MS

export function LoadingScreen() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const start = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS)
      setProgress(t)
      if (t < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const strokeOffset = CIRCUMFERENCE * (1 - progress)

  return (
    <div className="relative flex h-full min-h-screen flex-col bg-white">
      <div className="flex flex-1 items-center justify-center">
        <div
          className="relative"
          style={{ width: RING_SIZE, height: RING_SIZE }}
          aria-hidden
        >
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
      </div>

      <footer className="w-full bg-[#e8e8e8] py-3 text-center">
        <p className="text-sm font-normal text-[#4a4a4a]">Développé par Initiative Judo</p>
      </footer>
    </div>
  )
}
