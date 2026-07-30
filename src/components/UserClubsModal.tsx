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

/**
 * Modal : clubs enregistrés par un utilisateur, judokas dépliables par club.
 */
export function UserClubsModal({ username, onClose, onTransferred }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [judokas, setJudokas] = useState<Judoka[]>([])
  const [openClubs, setOpenClubs] = useState<Set<string>>(new Set())
  const [users, setUsers] = useState<UserAccount[]>([])
  const [transferClub, setTransferClub] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferMessage, setTransferMessage] = useState<string | null>(null)

  const loadJudokas = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
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
      const res = await window.judovac.listUsers()
      if (res.ok) setUsers(res.data.items)
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
