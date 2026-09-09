import { useState } from 'react'
import { ArrowLeft, Download, RotateCcw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/layouts/AppShell'
import { BackupProgressModal, type BackupProgress } from '@/components/BackupProgressModal'

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
  const [confirmReset, setConfirmReset] = useState(false)
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('replace')
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [progressTitle, setProgressTitle] = useState('Chargement')

  async function doExport(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    setProgressTitle('Export de la sauvegarde')
    setProgress({ label: 'Démarrage…', current: 0, total: 6 })
    try {
      const res = await window.judovac.exportBackup((p) => setProgress(p))
      if (!res.ok) {
        setError(res.error)
        return
      }
      setMessage(
        `Sauvegarde créée — ${res.data.manifest.counts.judokas} judokas (Serveur + tous les comptes clients). Les données enregistrées ne sont pas effacées. → ${res.data.path}`
      )
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  async function startRestore(): Promise<void> {
    setError(null)
    setMessage(null)
    setProgressTitle('Lecture de la sauvegarde')
    try {
      const pick = await window.judovac.pickBackupFile((p) => setProgress(p))
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
    } finally {
      setProgress(null)
    }
  }

  async function confirmRestore(): Promise<void> {
    if (!pending) return
    setBusy(true)
    setError(null)
    setMessage(null)
    setProgressTitle('Restauration de la sauvegarde')
    setProgress({ label: 'Démarrage…', current: 0, total: 3 })
    try {
      const res = await window.judovac.importBackup({ path: pending.path, mode: restoreMode }, (p) =>
        setProgress(p)
      )
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
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  async function confirmResetJudokas(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const reset = await window.judovac.resetJudokas({ scope: 'all' })
      if (!reset.ok) {
        setError(reset.error)
        return
      }
      setConfirmReset(false)
      setMessage(
        `Réinitialisation terminée — ${reset.data.deleted} judoka(s) et tous les clubs (individuel et par équipe) ont été supprimés.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Réinitialisation impossible')
    } finally {
      setBusy(false)
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
      <div className="mx-auto max-w-3xl space-y-4 animate-fade-in rounded-xl border bg-white/75 p-6">
        <p className="text-sm text-muted-foreground">
          Réservé au mode Serveur. L’export produit un fichier `.jvac` (judokas, photos,
          paramètres) utilisable aussi bien en version Online qu’Offline, sans effacer les
          données existantes.
        </p>
        <div className="flex flex-nowrap items-center gap-3 overflow-x-auto">
          <Button variant="accent" size="lg" className="shrink-0" disabled={busy} onClick={() => void doExport()}>
            <Download className="h-4 w-4" />
            Exporter
          </Button>
          <Button variant="outline" size="lg" className="shrink-0" disabled={busy} onClick={() => void startRestore()}>
            <Upload className="h-4 w-4" />
            Restaurer
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              setError(null)
              setMessage(null)
              setConfirmReset(true)
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Réinitialiser
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700 break-all">{message}</p>}
      </div>

      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-judokas-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="reset-judokas-title" className="text-lg font-semibold text-judo-navy">
              Réinitialiser les données
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Tous les noms et données des judokas seront supprimés (individuel et par équipe),
              ainsi que tous les clubs enregistrés. Cette action est irréversible.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Les utilisateurs, le nom de l’événement, le logo et les autres paramètres sont
              conservés.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmReset(false)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void confirmResetJudokas()}
              >
                {busy ? 'Réinitialisation…' : 'Réinitialiser'}
              </Button>
            </div>
          </div>
        </div>
      )}

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

      {progress ? <BackupProgressModal title={progressTitle} progress={progress} /> : null}
    </AppShell>
  )
}
