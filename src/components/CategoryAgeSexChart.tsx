import { useMemo } from 'react'

export type AgeSexBar = {
  age: number
  boys: number
  girls: number
}

/**
 * Graphique SVG : effectifs garçons / filles par âge (ans).
 */
export function CategoryAgeSexChart({
  data,
  categoryName
}: {
  data: AgeSexBar[]
  categoryName: string
}) {
  const maxVal = useMemo(() => {
    let m = 1
    for (const d of data) m = Math.max(m, d.boys, d.girls)
    return m
  }, [data])

  const totalBoys = data.reduce((s, d) => s + d.boys, 0)
  const totalGirls = data.reduce((s, d) => s + d.girls, 0)

  if (data.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
        Aucun judoka pour la catégorie « {categoryName} ».
      </p>
    )
  }

  const chartW = Math.max(320, data.length * 56)
  const chartH = 220
  const padL = 36
  const padR = 12
  const padT = 16
  const padB = 36
  const plotW = chartW - padL - padR
  const plotH = chartH - padT - padB
  const groupW = plotW / data.length
  const barW = Math.min(16, groupW * 0.32)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 px-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-600" />
          Garçons ({totalBoys})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" />
          Filles ({totalGirls})
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-slate-50/60 p-2">
        <svg
          width={chartW}
          height={chartH}
          viewBox={`0 0 ${chartW} ${chartH}`}
          role="img"
          aria-label={`Garçons et filles par âge — ${categoryName}`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = padT + plotH * (1 - t)
            const val = Math.round(maxVal * t)
            return (
              <g key={t}>
                <line
                  x1={padL}
                  x2={chartW - padR}
                  y1={y}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={9}
                  fill="#64748b"
                >
                  {val}
                </text>
              </g>
            )
          })}
          {data.map((d, i) => {
            const cx = padL + groupW * i + groupW / 2
            const boysH = (d.boys / maxVal) * plotH
            const girlsH = (d.girls / maxVal) * plotH
            const baseY = padT + plotH
            return (
              <g key={d.age}>
                <rect
                  x={cx - barW - 2}
                  y={baseY - boysH}
                  width={barW}
                  height={Math.max(0, boysH)}
                  fill="#0284c7"
                  rx={2}
                />
                <rect
                  x={cx + 2}
                  y={baseY - girlsH}
                  width={barW}
                  height={Math.max(0, girlsH)}
                  fill="#f43f5e"
                  rx={2}
                />
                {d.boys > 0 && (
                  <text
                    x={cx - barW / 2 - 2}
                    y={baseY - boysH - 3}
                    textAnchor="middle"
                    fontSize={8}
                    fill="#0369a1"
                    fontWeight={600}
                  >
                    {d.boys}
                  </text>
                )}
                {d.girls > 0 && (
                  <text
                    x={cx + barW / 2 + 2}
                    y={baseY - girlsH - 3}
                    textAnchor="middle"
                    fontSize={8}
                    fill="#e11d48"
                    fontWeight={600}
                  >
                    {d.girls}
                  </text>
                )}
                <text
                  x={cx}
                  y={chartH - 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#0f172a"
                  fontWeight={600}
                >
                  {d.age} ans
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
