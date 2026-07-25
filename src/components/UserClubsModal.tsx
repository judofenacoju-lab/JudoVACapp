import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName, resolveJudokaCategory } from '@shared/utils/judoka'
import { Button } from '@/components/ui/button'

interface Props {
  username: string
  onClose: () => void
}

type ClubGroup = {
  club: string
  judokas: Judoka[]
}

/**
 * Modal : clubs enregistrés par un utilisateur, judokas dépliables par club.
 */
export function UserClubsModal({ username, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [judokas, setJudokas] = useState<Judoka[]>([])
  const [openClubs, setOpenClubs] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      const res = await window.judovac.searchJudokas('', { createdBy: username })
      if (cancelled) return
      setLoading(false)
      if (!res.ok) {
        setError(res.error)
        setJudokas([])
        return
      }
      setJudokas(res.data.items)
    })()
    return () => {
      cancelled = true
    }
  }, [username])

  const clubs = useMemo((): ClubGroup[] => {
    const map = new Map<string, Judoka[]>()
    for (const j of judokas) {
      const key = j.club.trim() || 'Sans club'
      const list = map.get(key) ?? []
      list.push(j)
      map.set(key, list)
    }
    return [...map.entries()]
      .map(([club, items]) => ({
        club,
        judokas: items.sort((a, b) =>
          formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
        )
      }))
      .sort((a, b) => {
        if (a.club === 'Sans club') return 1
        if (b.club === 'Sans club') return -1
        return a.club.localeCompare(b.club, 'fr')
      })
  }, [judokas])

  function toggleClub(club: string): void {
    setOpenClubs((prev) => {
      const next = new Set(prev)
      if (next.has(club)) next.delete(club)
      else next.add(club)
      return next
    })
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
        aria-labelledby="user-clubs-title"
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 id="user-clubs-title" className="font-display text-lg font-semibold text-judo-navy">
              Clubs — {username}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {loading
                ? 'Chargement…'
                : `${clubs.length} club(s) · ${judokas.length} judoka(s)`}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3">
          {error && <p className="px-2 text-sm text-destructive">{error}</p>}
          {!loading && !error && clubs.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">Aucun judoka pour cet utilisateur.</p>
          )}
          <ul className="space-y-1">
            {clubs.map((group) => {
              const open = openClubs.has(group.club)
              return (
                <li key={group.club} className="rounded-lg border bg-white">
                  <button
                    type="button"
                    onClick={() => toggleClub(group.club)}
                    className="flex w-full items-center gap-2 bg-transparent px-3 py-2.5 text-left hover:bg-judo-navy/5"
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-judo-navy" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-judo-navy" />
                    )}
                    <span className="min-w-0 flex-1 font-medium text-judo-navy">{group.club}</span>
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
                            className="border-b border-border/50 py-2 text-sm last:border-0"
                          >
                            <p className="font-medium text-judo-navy">{formatJudokaFullName(j)}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {[
                                j.displayId,
                                j.birthDate
                                  ? `né(e) ${new Date(j.birthDate + 'T12:00:00').toLocaleDateString('fr-FR')}`
                                  : null,
                                category || null
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
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
