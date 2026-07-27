import { cn } from '@/lib/utils'

interface Props {
  icon: React.ReactNode
  label: string
  value: string
  /** Texte secondaire sous la valeur (ex. détail garçons / filles). */
  hint?: string
  tone?: 'ok' | 'warn' | 'muted' | 'default'
  /** Action optionnelle (ex. bouton Actualiser) à droite du libellé */
  action?: React.ReactNode
  /** Clic sur la valeur (ex. ouvrir un modal). */
  onValueClick?: () => void
  valueTitle?: string
}

export function StatTile({
  icon,
  label,
  value,
  hint,
  tone = 'default',
  action,
  onValueClick,
  valueTitle
}: Props) {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-judo-navy'

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="text-judo-red">{icon}</span>
        <span className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide">{label}</span>
        {action}
      </div>
      {onValueClick ? (
        <button
          type="button"
          title={valueTitle}
          onClick={onValueClick}
          className={cn(
            'mt-2 bg-transparent p-0 text-left text-2xl font-semibold underline-offset-4 hover:underline',
            toneClass
          )}
        >
          {value}
        </button>
      ) : (
        <p className={cn('mt-2 text-2xl font-semibold', toneClass)}>{value}</p>
      )}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
