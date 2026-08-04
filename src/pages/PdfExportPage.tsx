import { useEffect, useState } from 'react'
import { ArrowLeft, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import { hasRecordedWeight } from '@shared/utils/judoka'

interface Props {
  onBack: () => void
  embedded?: boolean
}

/**
 * Export PDF badges — judokas pesés uniquement, filtrables par utilisateur puis par club.
 */
export function PdfExportPage({ onBack, embedded = false }: Props) {
  const [perPage, setPerPage] = useState<4 | 6 | 8>(4)
  const [creators, setCreators] = useState<string[]>(['Serveur'])
  const [clubs, setClubs] = useState<string[]>([])
  const [clubCounts, setClubCounts] = useState<Record<string, number>>({})
  const [weighedTotal, setWeighedTotal] = useState(0)
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedClub, setSelectedClub] = useState('')
  const [clubsLoading, setClubsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const creatorsRes = await window.judovac.listJudokaCreators()
      if (cancelled) return
      if (creatorsRes.ok) {
        const items = creatorsRes.data.items.length > 0 ? creatorsRes.data.items : ['Serveur']
        setCreators(items)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Clubs des judokas pesés — recalculés dès qu’on change d’utilisateur. */
  useEffect(() => {
    let cancelled = false
    setClubsLoading(true)
    setSelectedClub('')
    void (async () => {
      try {
        const filters: Record<string, string> = {}
        if (selectedUser) filters.createdBy = selectedUser
        const res = await window.judovac.searchJudokas('', filters)
        if (cancelled) return
        if (!res.ok) {
          setClubs([])
          setClubCounts({})
          setWeighedTotal(0)
          return
        }

        const counts = new Map<string, number>()
        let total = 0
        for (const j of res.data.items) {
          if (!hasRecordedWeight(j.weightKg)) continue
          total += 1
          const name = j.club.trim() || 'Sans club'
          counts.set(name, (counts.get(name) ?? 0) + 1)
        }

        const names = [...counts.keys()].sort((a, b) => {
          if (a === 'Sans club') return 1
          if (b === 'Sans club') return -1
          return a.localeCompare(b, 'fr')
        })
        setClubs(names)
        setClubCounts(Object.fromEntries(counts))
        setWeighedTotal(total)
      } finally {
        if (!cancelled) setClubsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedUser])

  async function exportBadges(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)

    const opts: {
      all?: boolean
      createdBy?: string
      club?: string
      weighedOnly: true
      perPage: 4 | 6 | 8
    } = {
      weighedOnly: true,
      perPage
    }

    if (selectedUser) {
      opts.createdBy = selectedUser
    } else {
      opts.all = true
    }
    if (selectedClub) {
      opts.club = selectedClub
    }

    const res = await window.judovac.exportBadgesPdf(opts)
    setBusy(false)
    if (!res.ok) {
      const err = res.error
      if (/Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(err)) {
        setError(
          'Module PDF obsolète après une mise à jour. Rechargez la page (Ctrl+Shift+R / Cmd+Shift+R) puis réessayez.'
        )
        return
      }
      setError(err)
      return
    }

    const scopeParts: string[] = ['pesés']
    if (selectedUser) scopeParts.push(`utilisateur « ${selectedUser} »`)
    if (selectedClub) scopeParts.push(`club « ${selectedClub} »`)
    setMessage(
      `${res.data.count} badge(s) (${scopeParts.join(', ')}) exporté(s) → ${res.data.path}`
    )
  }

  const userLabel = selectedUser || 'tous les utilisateurs'
  const exportLabel = (() => {
    if (busy) return 'Génération…'
    if (selectedClub) {
      const n = clubCounts[selectedClub]
      return n != null
        ? `Exporter ${selectedClub} (${n} pesé${n > 1 ? 's' : ''})`
        : `Exporter le club ${selectedClub}`
    }
    if (selectedUser) {
      return weighedTotal > 0
        ? `Exporter ${selectedUser} (${weighedTotal} pesé${weighedTotal > 1 ? 's' : ''})`
        : `Exporter les badges de ${selectedUser}`
    }
    return weighedTotal > 0
      ? `Exporter tous les badges pesés (${weighedTotal})`
      : 'Exporter tous les badges pesés'
  })()

  return (
    <AppShell
      embedded={embedded}
      title="Export PDF"
      subtitle="Badges des judokas pesés — choisissez un utilisateur, puis un club"
      actions={
        !embedded ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-lg space-y-6 animate-fade-in rounded-xl border bg-white/75 p-6">
        <p className="text-sm text-muted-foreground">
          Seuls les judokas avec un poids enregistré sont inclus. Après l’utilisateur, choisissez un
          club pour limiter l’export.
        </p>

        <div className="space-y-2">
          <Label>Disposition</Label>
          <div className="flex flex-wrap gap-2">
            {([4, 6, 8] as const).map((n) => (
              <Button
                key={n}
                type="button"
                variant={perPage === n ? 'accent' : 'outline'}
                onClick={() => setPerPage(n)}
              >
                {n} / page
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="export-user">1. Utilisateur</Label>
          <select
            id="export-user"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            disabled={busy}
          >
            <option value="">Tous les utilisateurs</option>
            {creators.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 rounded-lg border border-judo-navy/15 bg-slate-50/80 p-3">
          <Label htmlFor="export-club">2. Club (pour {userLabel})</Label>
          <select
            id="export-club"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedClub}
            onChange={(e) => setSelectedClub(e.target.value)}
            disabled={busy || clubsLoading}
          >
            <option value="">
              {clubsLoading
                ? 'Chargement des clubs…'
                : weighedTotal > 0
                  ? `Tous les clubs (${weighedTotal} pesé${weighedTotal > 1 ? 's' : ''})`
                  : 'Tous les clubs'}
            </option>
            {clubs.map((club) => (
              <option key={club} value={club}>
                {club} ({clubCounts[club] ?? 0})
              </option>
            ))}
          </select>
          {!clubsLoading && clubs.length === 0 && (
            <p className="text-xs text-amber-700">
              Aucun club avec judoka pesé pour {userLabel}.
            </p>
          )}
          {!clubsLoading && clubs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button
                type="button"
                size="sm"
                variant={selectedClub === '' ? 'accent' : 'outline'}
                disabled={busy}
                onClick={() => setSelectedClub('')}
              >
                Tous
              </Button>
              {clubs.map((club) => (
                <Button
                  key={club}
                  type="button"
                  size="sm"
                  variant={selectedClub === club ? 'accent' : 'outline'}
                  disabled={busy}
                  onClick={() => setSelectedClub(club)}
                  title={`${clubCounts[club] ?? 0} pesé(s)`}
                >
                  {club}
                  <span className="ml-1 opacity-70">({clubCounts[club] ?? 0})</span>
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t pt-4">
          <Button
            variant="accent"
            size="lg"
            className="w-full"
            disabled={busy || clubsLoading || weighedTotal === 0}
            onClick={() => void exportBadges()}
          >
            <FileDown className="h-4 w-4" />
            {exportLabel}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700 break-all">{message}</p>}
      </div>
    </AppShell>
  )
}
