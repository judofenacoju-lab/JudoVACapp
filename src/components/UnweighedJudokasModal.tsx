import { useEffect, useState } from 'react'
import { Scale, X } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName, hasRecordedWeight, resolveJudokaCategory } from '@shared/utils/judoka'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  onClose: () => void
  /** Après validation d’un poids (rafraîchir le dashboard). */
  onUpdated?: () => void
  /** Ouvrir le formulaire complet (focus poids). */
  onOpenForm?: (judoka: Judoka) => void
}

/**
 * Modal : judokas sans poids — saisie rapide + validation.
 */
export function UnweighedJudokasModal({ onClose, onUpdated, onOpenForm }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Judoka[]>([])
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const pageSize = 1000
      const all: Judoka[] = []
      let offset = 0
      for (;;) {
        const res = await window.judovac.listJudokas({ limit: pageSize, offset })
        if (!res.ok) {
          setError(res.error)
          setItems([])
          return
        }
        all.push(...res.data.items)
        if (res.data.items.length < pageSize) break
        offset += pageSize
      }
      const unweighed = all
        .filter((j) => !hasRecordedWeight(j.weightKg))
        .sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
      setItems(unweighed)
      setWeights({})
      setRowError({})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function saveWeight(j: Judoka): Promise<void> {
    const raw = (weights[j.id] ?? '').trim().replace(',', '.')
    const value = Number(raw)
    if (!raw || !Number.isFinite(value) || value <= 0 || value > 300) {
      setRowError((prev) => ({
        ...prev,
        [j.id]: 'Indiquez un poids valide (ex. 73 ou 66.5)'
      }))
      return
    }
    setBusyId(j.id)
    setRowError((prev) => {
      const next = { ...prev }
      delete next[j.id]
      return next
    })
    const res = await window.judovac.updateJudoka(j.id, {
      ...j,
      weightKg: value
    })
    setBusyId(null)
    if (!res.ok) {
      setRowError((prev) => ({ ...prev, [j.id]: res.error }))
      return
    }
    setItems((prev) => prev.filter((x) => x.id !== j.id))
    setWeights((prev) => {
      const next = { ...prev }
      delete next[j.id]
      return next
    })
    onUpdated?.()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fermer"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unweighed-title"
        className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 id="unweighed-title" className="font-display text-lg font-semibold text-judo-navy">
              Judokas non pesés
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {loading
                ? 'Chargement…'
                : `${items.length} judoka(s) sans poids — saisissez et validez`}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3">
          {error && <p className="px-2 text-sm text-destructive">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="px-2 text-sm text-emerald-700">Tous vos judokas ont un poids renseigné.</p>
          )}
          <ul className="space-y-2">
            {items.map((j) => {
              const category = resolveJudokaCategory(j.birthDate, j.category)
              return (
                <li key={j.id} className="rounded-lg border bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-judo-navy">{formatJudokaFullName(j)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          j.displayId,
                          j.sex === 'F' ? 'Fille' : 'Garçon',
                          j.club.trim() || null,
                          category || null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {onOpenForm && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => onOpenForm(j)}
                      >
                        Formulaire
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-[7rem] flex-1 space-y-1">
                      <label htmlFor={`w-${j.id}`} className="text-xs font-medium text-judo-navy">
                        Poids (kg)
                      </label>
                      <Input
                        id={`w-${j.id}`}
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="300"
                        placeholder="Ex. 73"
                        value={weights[j.id] ?? ''}
                        disabled={busyId === j.id}
                        onChange={(e) =>
                          setWeights((prev) => ({ ...prev, [j.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void saveWeight(j)
                          }
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="accent"
                      size="sm"
                      className="h-10"
                      disabled={busyId === j.id}
                      onClick={() => void saveWeight(j)}
                    >
                      <Scale className="h-4 w-4" />
                      {busyId === j.id ? '…' : 'Valider'}
                    </Button>
                  </div>
                  {rowError[j.id] && (
                    <p className="mt-1 text-xs text-destructive">{rowError[j.id]}</p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
