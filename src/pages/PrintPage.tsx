import { useState } from 'react'
import { ArrowLeft, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'

interface Props {
  onBack: () => void
  embedded?: boolean
}

/**
 * Impression badges — version Web : génère un PDF téléchargeable
 * (ouvrez-le puis imprimez via le navigateur / lecteur PDF).
 */
export function PrintPage({ onBack, embedded = false }: Props) {
  const [perPage, setPerPage] = useState<4 | 6 | 8>(4)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function printAll(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await window.judovac.exportBadgesPdf({ all: true, perPage })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(
      `${res.data.count} badge(s) exporté(s). Ouvrez le PDF téléchargé et utilisez Ctrl+P pour imprimer.`
    )
  }

  return (
    <AppShell
      embedded={embedded}
      title="Impression"
      subtitle="Export PDF puis impression via le navigateur"
      actions={
        !embedded ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-lg space-y-5 animate-fade-in rounded-xl border bg-white/75 p-6">
        <p className="text-sm text-muted-foreground">
          Sur le Web, l&apos;impression passe par un PDF : téléchargez-le, ouvrez-le, puis lancez
          l&apos;impression de votre navigateur ou lecteur PDF.
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

        <Button variant="accent" size="lg" disabled={busy} onClick={() => void printAll()}>
          <FileDown className="h-4 w-4" />
          {busy ? 'Génération…' : 'Générer le PDF à imprimer'}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
      </div>
    </AppShell>
  )
}
