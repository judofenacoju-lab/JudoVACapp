import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, ChevronDown, ChevronRight, X } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import type { UserAccount } from '@shared/types/user-account'
import { formatJudokaFullName, resolveJudokaCategory } from '@shared/utils/judoka'
import { formatCreatorLabel } from '@shared/utils/creator'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface Props {
  username: string
  onClose: () => void
  onTransferred?: () => void
}

type ClubGroup = {
  club: string
  judokas: Judoka[]
}

/** Conserve chaque orthographe distincte (après trim), tri alphabétique. */
function distinctClubLabels(...lists: Array<string[] | undefined | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const raw of list ?? []) {
      const name = raw.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'fr'))
}

/**
 * Modal : clubs enregistrés par un utilisateur, judokas dépliables par club.
 */
export function UserClubsModal({ username, onClose, onTransferred }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [judokas, setJudokas] = useState<Judoka[]>([])
  const [configuredClubs, setConfiguredClubs] = useState<string[]>([])
  const [catalogClubs, setCatalogClubs] = useState<string[]>([])
  const [openClubs, setOpenClubs] = useState<Set<string>>(new Set())
  const [users, setUsers] = useState<UserAccount[]>([])
  const [transferClub, setTransferClub] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferMessage, setTransferMessage] = useState<string | null>(null)
  const [movingJudokaId, setMovingJudokaId] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const loadJudokas = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    // Sans opts.limit → chargement complet + filtre créateur (fiable sur Mac)
    const res = await window.judovac.searchJudokas('', { createdBy: username })
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      setJudokas([])
      return
    }
    setJudokas(res.data.items)
  }, [username])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadJudokas()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [loadJudokas])

  useEffect(() => {
    void (async () => {
      const [usersRes, settingsRes, clubsRes] = await Promise.all([
        window.judovac.listUsers(),
        window.judovac.getSettings(),
        window.judovac.listJudokaClubNames()
      ])
      if (usersRes.ok) setUsers(usersRes.data.items)
      if (settingsRes.ok) {
        // Liste Configuration telle quelle (chaque entrée / orthographe)
        setConfiguredClubs(distinctClubLabels(settingsRes.data.clubs))
      }
      if (clubsRes.ok) {
        setCatalogClubs(distinctClubLabels(clubsRes.data.items))
      }
    })()
  }, [])

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

  const clubOptions = useMemo(() => {
    const fromJudokas = judokas.map((j) => j.club.trim()).filter(Boolean)
    // Configuration + tous clubs en base + clubs de cet utilisateur (orthographes exactes)
    return distinctClubLabels(configuredClubs, catalogClubs, fromJudokas)
  }, [configuredClubs, catalogClubs, judokas])

  const transferTargets = useMemo(
    () =>
      users.filter(
        (u) => formatCreatorLabel(u.username) !== formatCreatorLabel(username)
      ),
    [users, username]
  )

  const transferClubCount = useMemo(() => {
    if (!transferClub) return 0
    return clubs.find((g) => g.club === transferClub)?.judokas.length ?? 0
  }, [clubs, transferClub])

  function toggleClub(club: string): void {
    setOpenClubs((prev) => {
      const next = new Set(prev)
      if (next.has(club)) next.delete(club)
      else next.add(club)
      return next
    })
  }

  function openTransfer(club: string): void {
    setTransferClub(club)
    setTransferTarget(transferTargets[0]?.username ?? '')
    setTransferError(null)
    setTransferMessage(null)
  }

  async function changeJudokaClub(judoka: Judoka, nextClub: string): Promise<void> {
    const current = judoka.club.trim() || 'Sans club'
    const target = nextClub.trim()
    if (!target || target.toLowerCase() === current.toLowerCase()) return

    setMovingJudokaId(judoka.id)
    setMoveError(null)
    setTransferMessage(null)
    const res = await window.judovac.updateJudoka(judoka.id, { club: target })
    setMovingJudokaId(null)
    if (!res.ok) {
      setMoveError(res.error)
      return
    }
    setOpenClubs((prev) => {
      const next = new Set(prev)
      next.add(current)
      next.add(target)
      return next
    })
    setTransferMessage(
      `${formatJudokaFullName(judoka)} déplacé de « ${current} » vers « ${target} ».`
    )
    await loadJudokas()
    onTransferred?.()
  }

  async function confirmTransfer(): Promise<void> {
    if (!transferClub || !transferTarget) {
      setTransferError('Choisissez un utilisateur de destination.')
      return
    }
    setTransferBusy(true)
    setTransferError(null)
    const res = await window.judovac.transferUserClubJudokas({
      fromUsername: username,
      toUsername: transferTarget,
      clubName: transferClub
    })
    setTransferBusy(false)
    if (!res.ok) {
      setTransferError(res.error)
      return
    }
    setTransferClub(null)
    setTransferMessage(
      `${res.data.transferred} judoka(s) du club « ${res.data.club} » transférés vers ${res.data.to}.`
    )
    await loadJudokas()
    onTransferred?.()
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
        className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
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
          {moveError && (
            <p className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {moveError}
            </p>
          )}
          {transferMessage && (
            <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {transferMessage}
            </p>
          )}
          {!loading && !error && clubs.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">Aucun judoka pour cet utilisateur.</p>
          )}
          <ul className="space-y-1">
            {clubs.map((group) => {
              const open = openClubs.has(group.club)
              return (
                <li key={group.club} className="rounded-lg border bg-white">
                  <div className="flex items-stretch gap-1">
                    <button
                      type="button"
                      onClick={() => toggleClub(group.club)}
                      className="flex min-w-0 flex-1 items-center gap-2 bg-transparent px-3 py-2.5 text-left hover:bg-judo-navy/5"
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="my-1.5 mr-1.5 h-8 shrink-0 gap-1 px-2 text-xs"
                      title={`Délocaliser ce club vers un autre utilisateur (${group.judokas.length} judoka(s))`}
                      onClick={() => openTransfer(group.club)}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      Délocaliser
                    </Button>
                  </div>
                  {open && (
                    <ul className="border-t bg-slate-50/80 px-3 py-2">
                      {group.judokas.map((j) => {
                        const category = resolveJudokaCategory(j.birthDate, j.category)
                        const currentClub = j.club.trim() || 'Sans club'
                        const selectValue = currentClub === 'Sans club' ? '' : currentClub
                        const optionsForRow = distinctClubLabels(
                          clubOptions,
                          selectValue ? [selectValue] : []
                        )
                        const busy = movingJudokaId === j.id
                        return (
                          <li
                            key={j.id}
                            className="border-b border-border/50 py-2 text-sm last:border-0"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-judo-navy">
                                  {formatJudokaFullName(j)}
                                </p>
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
                              </div>
                              <div className="w-full shrink-0 sm:min-w-[14rem] sm:w-56">
                                <Label
                                  htmlFor={`move-club-${j.id}`}
                                  className="mb-1 block text-[11px] text-muted-foreground"
                                >
                                  Changer de club
                                </Label>
                                <select
                                  id={`move-club-${j.id}`}
                                  className="flex h-9 w-full rounded-md border border-input bg-white px-2 text-xs disabled:opacity-60"
                                  value={selectValue}
                                  disabled={busy || movingJudokaId != null || optionsForRow.length === 0}
                                  title="Déplacer ce judoka vers un autre club"
                                  onChange={(e) => {
                                    const next = e.target.value
                                    if (!next) return
                                    void changeJudokaClub(j, next)
                                  }}
                                >
                                  {optionsForRow.length === 0 ? (
                                    <option value="">Aucun club répertorié</option>
                                  ) : (
                                    <>
                                      {currentClub === 'Sans club' && (
                                        <option value="">Sans club</option>
                                      )}
                                      {optionsForRow.map((club) => (
                                        <option key={club} value={club}>
                                          {club}
                                        </option>
                                      ))}
                                    </>
                                  )}
                                </select>
                                {busy && (
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    Déplacement…
                                  </p>
                                )}
                              </div>
                            </div>
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

      {transferClub && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Annuler"
            onClick={() => !transferBusy && setTransferClub(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-club-title"
            className="relative z-10 w-full max-w-md rounded-xl border bg-white p-6 shadow-2xl"
          >
            <h3 id="transfer-club-title" className="text-lg font-semibold text-judo-navy">
              Délocaliser « {transferClub} »
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {transferClubCount} judoka(s) enregistré(s) par <strong>{username}</strong> seront
              réattribués à un autre utilisateur (données conservées : nom, poids, photo, etc.).
            </p>
            <div className="mt-4 space-y-2">
              <Label htmlFor="transfer-target-user">Nouvel utilisateur</Label>
              <select
                id="transfer-target-user"
                className="flex h-10 w-full rounded-md border border-input bg-white/80 px-3 text-sm"
                value={transferTarget}
                disabled={transferBusy || transferTargets.length === 0}
                onChange={(e) => setTransferTarget(e.target.value)}
              >
                {transferTargets.length === 0 ? (
                  <option value="">Aucun autre utilisateur</option>
                ) : (
                  transferTargets.map((u) => (
                    <option key={u.id} value={u.username}>
                      {u.displayName?.trim() && u.displayName !== u.username
                        ? `${u.displayName} (${u.username})`
                        : u.username}
                    </option>
                  ))
                )}
              </select>
            </div>
            {transferError && <p className="mt-3 text-sm text-destructive">{transferError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={transferBusy}
                onClick={() => setTransferClub(null)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={transferBusy || !transferTarget}
                onClick={() => void confirmTransfer()}
              >
                {transferBusy ? 'Transfert…' : 'Confirmer le transfert'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
