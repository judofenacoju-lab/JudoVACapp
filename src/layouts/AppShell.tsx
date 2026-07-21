import brandLogo from '@/assets/brand-logo.png'

interface Props {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  /** Affiché dans WorkspaceLayout : pas de barre marque pleine largeur */
  embedded?: boolean
}

export function AppShell({ title, subtitle, actions, children, embedded = false }: Props) {
  if (embedded) {
    return (
      <div className="animate-fade-in">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-judo-navy">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-white/40 bg-judo-navy/95 px-6 py-4 text-white shadow-md">
        <div className="flex items-start gap-3">
          <img
            src={brandLogo}
            alt=""
            className="mt-0.5 h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white/20"
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-judo-gold">JudoVACapp</p>
            <h1 className="mt-1 font-display text-xl font-semibold md:text-2xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-white/65">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </header>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
