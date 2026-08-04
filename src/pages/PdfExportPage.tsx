import { useEffect, useState } from 'react'
import { ArrowLeft, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import { mergeRegisteredClubNames } from '@shared/utils/clubs'

interface Props {
  onBack: () => void
  embedded?: boolean
}

/**
 * Export PDF badges — judokas pesés uniquement, filtrables par utilisateur et par club.
 */
export function PdfExportPage({ onBack, embedded = false }: Props) {
  const [perPage, setPerPage] = useState<4 | 6 | 8>(4)
  const [creators, setCreators] = useState<string[]>(['Serveur'])
  const [clubs, setClubs] = useState<string[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedClub, setSelectedClub] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const creatorsRes = await window.judovac.listJudokaCreators()
      const settingsRes = await window.judovac.getSettings()
      let fromJudokas: string[] = []
      try {
        const clubsRes = await window.judovac.listJudokaClubNames()
        if (clubsRes.ok) fromJudokas = clubsRes.data.items
      } catch {
        /* Electron / API absente : on s’appuie sur les paramètres */
      }
      if (cancelled) return

      if (creatorsRes.ok) {
        const items = creatorsRes.data.items.length > 0 ? creatorsRes.data.items : ['Serveur']
        setCreators(items)
      }

      const fromSettings = settingsRes.ok ? settingsRes.data.clubs : []
      setClubs(mergeRegisteredClubNames(fromSettings, fromJudokas))
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
      setError(res.error)
      return
    }

    const scopeParts: string[] = ['pesés']
    if (selectedUser) scopeParts.push(`utilisateur « ${selectedUser} »`)
    if (selectedClub) scopeParts.push(`club « ${selectedClub} »`)
    setMessage(
      `${res.data.count} badge(s) (${scopeParts.join(', ')}) exporté(s) → ${res.data.path}`
    )
  }

  return (
    <AppShell
      embedded={embedded}
      title="Export PDF"
      subtitle="Badges des judokas pesés — par utilisateur et/ou par club"
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
          Seuls les judokas avec un poids enregistré sont inclus dans l’export.
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
          <Label htmlFor="export-user">Utilisateur</Label>
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

        <div className="space-y-2">
          <Label htmlFor="export-club">Club</Label>
          <select
            id="export-club"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedClub}
            onChange={(e) => setSelectedClub(e.target.value)}
            disabled={busy}
          >
            <option value="">Tous les clubs</option>
            {clubs.map((club) => (
              <option key={club} value={club}>
                {club}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t pt-4">
          <Button
            variant="accent"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => void exportBadges()}
          >
            <FileDown className="h-4 w-4" />
            {busy
              ? 'Génération…'
              : selectedUser || selectedClub
                ? 'Exporter les badges filtrés'
                : 'Exporter tous les badges pesés'}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700 break-all">{message}</p>}
      </div>
    </AppShell>
  )
}
