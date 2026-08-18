export interface BackupProgress {
  label: string
  current: number
  total: number
}

export type BackupProgressFn = (progress: BackupProgress) => void

/**
 * Modal de suivi export / restauration .jvac — se ferme quand le parent retire `progress`.
 */
export function BackupProgressModal({
  title,
  progress
}: {
  title: string
  progress: BackupProgress
}) {
  const total = Math.max(1, progress.total)
  const pct = Math.min(100, Math.round((Math.max(0, progress.current) / total) * 100))
  const determinate = progress.total > 1

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-progress-title"
        aria-busy="true"
        className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
      >
        <h3 id="backup-progress-title" className="text-lg font-semibold text-judo-navy">
          {title}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">{progress.label}</p>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-200">
          {determinate ? (
            <div
              className="h-full rounded-full bg-judo-red transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-judo-red" />
          )}
        </div>
        <p className="mt-2 text-right text-xs font-medium tabular-nums text-judo-navy">
          {determinate ? `${pct} %` : 'En cours…'}
        </p>
      </div>
    </div>
  )
}
