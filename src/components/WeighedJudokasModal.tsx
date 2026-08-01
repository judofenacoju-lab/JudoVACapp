import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, IdCard, X } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import {
  formatJudokaFullName,
  hasRecordedWeight,
  resolveJudokaCategory
} from '@shared/utils/judoka'
import { Button } from '@/components/ui/button'

interface Props {
  onClose: () => void
}

type TeamGroup = {
  team: string
  judokas: Judoka[]
}

/**
 * Modal : judokas pesés regroupés par équipe (club), avec fiche photo.
 */
export function WeighedJudokasModal({ onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [judokas, setJudokas] = useState<Judoka[]>([])
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Judoka | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoLoading, setPhotoLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const pageSize = 1000
        const all: Judoka[] = []
        let offset = 0
        for (;;) {
          const res = await window.judovac.listJudokas({ limit: pageSize, offset })
          if (cancelled) return
          if (!res.ok) {
            setError(res.error)
            setJudokas([])
            setLoading(false)
            return
          }
          all.push(...res.data.items)
          if (all.length >= res.data.total || res.data.items.length < pageSize) break
          offset += pageSize
        }
        setJudokas(all.filter((j) => hasRecordedWeight(j.weightKg)))
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Chargement impossible')
        setJudokas([])
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selected?.photoPath) {
      setPhotoUrl(null)
      setPhotoLoading(false)
      return
    }
    let cancelled = false
    setPhotoLoading(true)
    setPhotoUrl(null)
    void (async () => {
      const res = await window.judovac.readPhotoDataUrl(selected.photoPath!)
      if (cancelled) return
      setPhotoLoading(false)
      setPhotoUrl(res.ok ? res.data.dataUrl : null)
    })()
    return () => {
      cancelled = true
    }
  }, [selected])

  const teams = useMemo((): TeamGroup[] => {
    const map = new Map<string, Judoka[]>()
    for (const j of judokas) {
      const key = j.club.trim() || 'Sans équipe'
      const list = map.get(key) ?? []
      list.push(j)
      map.set(key, list)
    }
    return [...map.entries()]
      .map(([team, items]) => ({
        team,
        judokas: items.sort((a, b) =>
          formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
        )
      }))
      .sort((a, b) => {
        if (a.team === 'Sans équipe') return 1
        if (b.team === 'Sans équipe') return -1
        return a.team.localeCompare(b.team, 'fr')
      })
  }, [judokas])

  function toggleTeam(team: string): void {
    setOpenTeams((prev) => {
      const next = new Set(prev)
      if (next.has(team)) next.delete(team)
      else next.add(team)
      return next
    })
  }

  if (selected) {
    const category = resolveJudokaCategory(selected.birthDate, selected.category)
    const birthLabel = selected.birthDate
      ? new Date(selected.birthDate + 'T12:00:00').toLocaleDateString('fr-FR')
      : '—'
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
          aria-labelledby="weighed-fiche-title"
          className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2
                id="weighed-fiche-title"
                className="font-display text-lg font-semibold text-judo-navy"
              >
                Fiche judoka
              </h2>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{selected.displayId}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-auto px-5 py-4">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="flex h-36 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
                {photoLoading ? (
                  <span className="text-xs text-muted-foreground">Photo…</span>
                ) : photoUrl ? (
                  <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="px-2 text-center text-xs text-muted-foreground">Sans photo</span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <p className="font-display text-lg font-semibold text-judo-navy">
                  {formatJudokaFullName(selected)}
                </p>
                <dl className="space-y-1.5">
                  <Row label="Sexe" value={selected.sex === 'F' ? 'Fille' : 'Garçon'} />
                  <Row label="Naissance" value={birthLabel} />
                  <Row label="Âge" value={String(selected.age ?? '—')} />
                  <Row label="Équipe" value={selected.club.trim() || 'Sans équipe'} />
                  <Row label="Catégorie" value={category || '—'} />
                  <Row
                    label="Poids"
                    value={selected.weightKg != null ? `${selected.weightKg} kg` : '—'}
                  />
                  <Row label="Grade" value={selected.grade || '—'} />
                  <Row label="Ceinture" value={selected.belt || '—'} />
                  <Row label="Licence" value={selected.licenseNumber || '—'} />
                </dl>
              </div>
            </div>
          </div>

          <div className="border-t px-5 py-3">
            <Button type="button" variant="outline" className="w-full" onClick={() => setSelected(null)}>
              Retour à la liste
            </Button>
          </div>
        </div>
      </div>
    )
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
        aria-labelledby="weighed-list-title"
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 id="weighed-list-title" className="font-display text-lg font-semibold text-judo-navy">
              Judokas pesés
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {loading
                ? 'Chargement…'
                : `${teams.length} équipe(s) · ${judokas.length} judoka(s)`}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3">
          {error && <p className="px-2 text-sm text-destructive">{error}</p>}
          {!loading && !error && teams.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">Aucun judoka pesé pour l’instant.</p>
          )}
          <ul className="space-y-1">
            {teams.map((group) => {
              const open = openTeams.has(group.team)
              return (
                <li key={group.team} className="rounded-lg border bg-white">
                  <button
                    type="button"
                    onClick={() => toggleTeam(group.team)}
                    className="flex w-full items-center gap-2 bg-transparent px-3 py-2.5 text-left hover:bg-judo-navy/5"
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-judo-navy" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-judo-navy" />
                    )}
                    <span className="min-w-0 flex-1 font-medium text-judo-navy">{group.team}</span>
                    <span className="rounded-full bg-judo-red/10 px-2 py-0.5 font-mono text-xs font-semibold text-judo-red">
                      {group.judokas.length}
                    </span>
                  </button>
                  {open && (
                    <ul className="border-t bg-slate-50/80 px-3 py-2">
                      {group.judokas.map((j) => {
                        const category = resolveJudokaCategory(j.birthDate, j.category)
                        return (
                          <li
                            key={j.id}
                            className="flex items-center justify-between gap-2 border-b border-border/50 py-2 text-sm last:border-0"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-judo-navy">{formatJudokaFullName(j)}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {[
                                  j.displayId,
                                  j.weightKg != null ? `${j.weightKg} kg` : null,
                                  category || null
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              onClick={() => setSelected(j)}
                            >
                              <IdCard className="h-4 w-4" />
                              Fiche
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-judo-navy">{value}</dd>
    </div>
  )
}
