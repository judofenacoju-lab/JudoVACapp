import { useEffect, useState, type ReactNode } from 'react'
import {
  Archive,
  FileDown,
  Home,
  IdCard,
  List,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  Settings
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import brandLogo from '@/assets/brand-logo.png'

export type ServerNavId =
  | 'home'
  | 'form'
  | 'list'
  | 'badge'
  | 'pdf'
  | 'print'
  | 'backup'
  | 'admin'

export type ClientNavId = 'home' | 'form' | 'list' | 'sync'

interface NavDef {
  id: string
  label: string
  icon: ReactNode
}

const SERVER_NAV: NavDef[] = [
  { id: 'home', label: 'Tableau de bord', icon: <Home className="h-4 w-4" /> },
  { id: 'form', label: 'Nouveau judoka', icon: <Plus className="h-4 w-4" /> },
  { id: 'list', label: 'Liste / Recherche', icon: <List className="h-4 w-4" /> },
  { id: 'badge', label: 'Badges', icon: <IdCard className="h-4 w-4" /> },
  { id: 'pdf', label: 'Export PDF', icon: <FileDown className="h-4 w-4" /> },
  { id: 'print', label: 'Impression', icon: <Printer className="h-4 w-4" /> },
  { id: 'backup', label: 'Sauvegarde', icon: <Archive className="h-4 w-4" /> },
  { id: 'admin', label: 'Configuration', icon: <Settings className="h-4 w-4" /> }
]

const CLIENT_NAV: NavDef[] = [
  { id: 'home', label: 'Tableau de bord', icon: <Home className="h-4 w-4" /> },
  { id: 'form', label: 'Nouveau judoka', icon: <Plus className="h-4 w-4" /> },
  { id: 'list', label: 'Liste / Recherche', icon: <List className="h-4 w-4" /> },
  { id: 'sync', label: 'Forcer la synchronisation', icon: <RefreshCw className="h-4 w-4" /> }
]

interface Props {
  role: 'server' | 'client'
  active: string
  onNavigate: (id: string) => void
  onLogout: () => void
  title: string
  subtitle?: string
  headerActions?: ReactNode
  children: ReactNode
}

/**
 * Shell applicatif avec navigation latérale permanente.
 */
export function WorkspaceLayout({
  role,
  active,
  onNavigate,
  onLogout,
  title,
  subtitle,
  headerActions,
  children
}: Props) {
  const items = role === 'server' ? SERVER_NAV : CLIENT_NAV
  const [eventName, setEventName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await window.judovac.getSettings()
      if (!cancelled && res.ok && res.data.event.name) {
        setEventName(res.data.event.name)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={cn(
          'flex w-56 shrink-0 flex-col text-white',
          role === 'server' ? 'bg-judo-red' : 'bg-judo-navy'
        )}
      >
        <div className="border-b border-white/10 px-4 py-5">
          <div className="flex items-center gap-3">
            <img
              src={brandLogo}
              alt="JudoVACapp"
              className="h-11 w-11 shrink-0 rounded-full object-cover shadow-md ring-2 ring-white/25"
            />
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold tracking-tight">JudoVACapp</p>
              <p className="mt-0.5 text-xs uppercase tracking-wider text-judo-gold">
                {role === 'server' ? 'Mode Serveur' : 'Mode Client'}
              </p>
            </div>
          </div>
          {eventName && (
            <p className="mt-3 line-clamp-2 text-xs text-white/60" title={eventName}>
              {eventName}
            </p>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-auto p-2">
          {items.map((item) => {
            const isActive = active === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                  isActive
                    ? role === 'server'
                      ? 'bg-white text-judo-red'
                      : 'bg-judo-red text-white'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                )}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <Button
            variant="ghost"
            className="w-full justify-start text-white/80 hover:bg-white/10 hover:text-white"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" />
            {role === 'server' ? 'Changer de mode' : 'Déconnexion'}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-4 border-b bg-white/60 px-6 py-4 backdrop-blur-sm">
          <div>
            <h1 className="font-display text-xl font-semibold text-judo-navy md:text-2xl">
              {title}
            </h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {headerActions}
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
