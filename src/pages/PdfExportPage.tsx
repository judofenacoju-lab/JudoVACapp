import { useEffect, useState } from 'react'
import { ArrowLeft, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'

interface Props {
  onBack: () => void
  embedded?: boolean
}

/**
 * Export PDF badges — par utilisateur ou tous, grille 4 / 6 / 8 par page.
 */
export function PdfExportPage({ onBack, embedded = false }: Props) {
  const [perPage, setPerPage] = useState<4 | 6 | 8>(4)
  const [creators, setCreators] = useState<string[]>(['Serveur'])
  const [selectedUser, setSelectedUser] = useState('Serveur')
  const [userPicked, setUserPicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await window.judovac.listJudokaCreators()
      if (!cancelled && res.ok) {
        const items = res.data.items.length > 0 ? res.data.items : ['Serveur']
        setCreators(items)
        setSelectedUser(items.includes('Serveur') ? 'Serveur' : (items[0] ?? 'Serveur'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function exportAll(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await window.judovac.exportBadgesPdf({ all: true, perPage })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(`${res.data.count} badge(s) exporté(s) → ${res.data.path}`)
  }

  async function exportByUser(): Promise<void> {
    if (!selectedUser) {
      setError('Sélectionnez un utilisateur.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await window.judovac.exportBadgesPdf({ createdBy: selectedUser, perPage })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(
      `${res.data.count} badge(s) de ${selectedUser} exporté(s) → ${res.data.path}`
    )
  }

  return (
    <AppShell
      embedded={embedded}
      title="Export PDF"
      subtitle="Impression Badges par utilisateur ou export complet"
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
          <Label htmlFor="export-user">Exporter pour</Label>
          <select
            id="export-user"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedUser}
            onChange={(e) => {
              setSelectedUser(e.target.value)
              setUserPicked(true)
            }}
            disabled={busy || creators.length === 0}
          >
            {creators.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
          {userPicked && selectedUser && (
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={() => void exportByUser()}
            >
              <FileDown className="h-4 w-4" />
              {busy ? 'Génération…' : `Exporter les badges de ${selectedUser}`}
            </Button>
          )}
        </div>

        <div className="border-t pt-4">
          <Button variant="accent" size="lg" className="w-full" disabled={busy} onClick={() => void exportAll()}>
            <FileDown className="h-4 w-4" />
            {busy ? 'Génération…' : 'Exporter tous les badges'}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700 break-all">{message}</p>}
      </div>
    </AppShell>
  )
}
