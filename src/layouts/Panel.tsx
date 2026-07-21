interface Props {
  title?: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
}

/**
 * En-tête de panneau léger — utilisé dans WorkspaceLayout (sans barre marque).
 */
export function PanelHeader({ title, subtitle, actions }: Omit<Props, 'children'>) {
  if (!title && !actions) return null
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        {title && <h2 className="text-lg font-semibold text-judo-navy">{title}</h2>}
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

/** Conteneur contenu pour pages embarquées dans la sidebar. */
export function Panel({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>
}
