import { useState } from 'react'
import { ArrowLeft, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/layouts/AppShell'

interface Props {
  onBack: () => void
  embedded?: boolean
}

type RestoreMode = 'replace' | 'merge'

interface PendingRestore {
  path: string
  judokaCount: number
  createdAt: string
}

/**
 * Sauvegarde / restauration format propriétaire .jvac
 */
export function BackupPage({ onBack, embedded = false }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingRestore | null>(null)
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('replace')

  async function doExport(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await window.judovac.exportBackup()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(
      `Sauvegarde créée — ${res.data.manifest.counts.judokas} judokas (Serveur + tous les comptes clients). Les données enregistrées ne sont pas effacées. → ${res.data.path}`
    )
  }

  async function startRestore(): Promise<void> {
    setError(null)
    setMessage(null)
    const pick = await window.judovac.pickBackupFile()
    if (!pick.ok) {
      if (pick.error !== 'Sélection annulée') setError(pick.error)
      return
    }
    setRestoreMode('replace')
    setPending({
      path: pick.data.path,
      judokaCount: pick.data.manifest.counts.judokas,
      createdAt: pick.data.manifest.createdAt
    })
  }

  async function confirmRestore(): Promise<void> {
    if (!pending) return
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await window.judovac.importBackup({ path: pending.path, mode: restoreMode })
    setBusy(false)
    setPending(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    if (res.data.mode === 'merge' && res.data.mergeStats) {
      const { added, skipped } = res.data.mergeStats
      setMessage(
        `Mise à jour terminée — ${added} judoka(s) ajouté(s), ${skipped} déjà présent(s). Chaque enregistrement reste attribué à son propriétaire.`
      )
    } else {
      setMessage(
        `Restauration terminée — ${res.data.manifest.counts.judokas} judokas importés (données précédentes effacées).`
      )
    }
  }

  return (
    <AppShell
      embedded={embedded}
      title="Sauvegarde"
      subtitle="Judokas + photos + assets + paramètres au format (.jvac)."
      actions={
        !embedded ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-lg space-y-4 animate-fade-in rounded-xl border bg-white/75 p-6">
        <p className="text-sm text-muted-foreground">
          Réservé au mode Serveur. L’export inclut tous les judokas enregistrés sur le Serveur et
          sur l’ensemble des comptes clients synchronisés, sans effacer les données existantes.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="accent" size="lg" disabled={busy} onClick={() => void doExport()}>
            <Download className="h-4 w-4" />
            Exporter
          </Button>
          <Button variant="outline" size="lg" disabled={busy} onClick={() => void startRestore()}>
            <Upload className="h-4 w-4" />
            Restaurer
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700 break-all">{message}</p>}
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-backup-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="restore-backup-title" className="text-lg font-semibold text-judo-navy">
              Restaurer la sauvegarde
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Fichier sélectionné — {pending.judokaCount} judoka(s)
              {pending.createdAt
                ? ` · ${new Date(pending.createdAt).toLocaleString('fr-FR')}`
                : ''}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Choisissez comment appliquer cette sauvegarde avant le chargement.
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-destructive/30 p-3 hover:bg-destructive/5">
                <input
                  type="radio"
                  name="restore-mode"
                  className="mt-1"
                  checked={restoreMode === 'replace'}
                  onChange={() => setRestoreMode('replace')}
                />
                <span className="text-sm">
                  <span className="font-medium text-destructive">Restaurer et Effacer</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Remplace toutes les données actuelles par celles de la sauvegarde.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                <input
                  type="radio"
                  name="restore-mode"
                  className="mt-1"
                  checked={restoreMode === 'merge'}
                  onChange={() => setRestoreMode('merge')}
                />
                <span className="text-sm">
                  <span className="font-medium text-judo-navy">Mis à jour</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Ajoute les nouveaux enregistrements sans effacer l’existant. Chaque judoka
                    reste attribué à son propriétaire ; le Serveur conserve une copie complète.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={busy}
                onClick={() => void confirmRestore()}
              >
                {busy ? 'Chargement…' : 'Charger la sauvegarde'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
