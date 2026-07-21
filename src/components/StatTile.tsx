import { cn } from '@/lib/utils'

interface Props {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'muted' | 'default'
  /** Action optionnelle (ex. bouton Actualiser) à droite du libellé */
  action?: React.ReactNode
}

export function StatTile({ icon, label, value, tone = 'default', action }: Props) {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-judo-navy'

  return (
    <div className="rounded-xl border bg-white/75 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="text-judo-red">{icon}</span>
        <span className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide">{label}</span>
        {action}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold', toneClass)}>{value}</p>
    </div>
  )
}
