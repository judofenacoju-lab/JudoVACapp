import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, FileDown, Pencil, Printer, Search, Trash2 } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName, resolveJudokaCategory, computeAge } from '@shared/utils/judoka'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'

interface Props {
  onBack: () => void
  onEdit?: (judoka: Judoka) => void
  /** Mode client : edit/delete passent par la file de sync */
  clientMode?: boolean
  /** Nom du compte client : limite la liste à ses propres enregistrements */
  clientUsername?: string
  embedded?: boolean
  /** Rafraîchissement automatique en arrière-plan (ms), ex. 1000 pour le serveur. */
  autoRefreshMs?: number
}

const PAGE_SIZE = 12

/**
 * Recherche + actions édition/suppression + sélection export/impression (serveur).
 */
export function JudokaListPage({
  onBack,
  onEdit,
  clientMode = false,
  clientUsername,
  embedded = false,
  autoRefreshMs
}: Props) {
  const [query, setQuery] = useState('')
  const [club, setClub] = useState('')
  const [province, setProvince] = useState('')
  const [league, setLeague] = useState('')
  const [grade, setGrade] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [creators, setCreators] = useState<string[]>([])
  const [items, setItems] = useState<Judoka[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pollTick, setPollTick] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  /** Total exact en base (tous les judokas du périmètre serveur / opérateur). */
  const [systemTotal, setSystemTotal] = useState<number | null>(null)

  const filters = useMemo(
    () => ({
      ...(club ? { club } : {}),
      ...(province ? { province } : {}),
      ...(league ? { league } : {}),
      ...(grade ? { grade } : {}),
      ...(createdBy ? { createdBy } : {})
    }),
    [club, province, league, grade, createdBy]
  )

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    if (!autoRefreshMs) return
    const id = setInterval(() => setPollTick((t) => t + 1), autoRefreshMs)
    return () => clearInterval(id)
  }, [autoRefreshMs])

  // Temps réel : nouveau judoka (admin ou opérateur) → rafraîchir sans recharger la page
  useEffect(() => {
    if (!window.judovac.subscribeJudokas) return
    return window.judovac.subscribeJudokas(() => {
      setPollTick((t) => t + 1)
    })
  }, [])

  useEffect(() => {
    if (clientMode) {
      setCreators([])
      return
    }
    let cancelled = false
    void (async () => {
      const res = await window.judovac.listJudokaCreators()
      if (!cancelled && res.ok) setCreators(res.data.items)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey, pollTick, clientMode])

  useEffect(() => {
    setSelected(new Set())
    setPageIndex(0)
  }, [query, club, province, league, grade, createdBy])

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE))

  useEffect(() => {
    setPageIndex((p) => Math.min(p, pageCount - 1))
  }, [pageCount])

  const pageItems = useMemo(() => {
    const start = pageIndex * PAGE_SIZE
    return items.slice(start, start + PAGE_SIZE)
  }, [items, pageIndex])

  useEffect(() => {
    if (clientMode) return
    let cancelled = false
    void (async () => {
      const stats = await window.judovac.getDashboardStats()
      if (!cancelled && stats.ok) setSystemTotal(stats.data.totalJudokas)
    })()
    return () => {
      cancelled = true
    }
  }, [clientMode, refreshKey])

  useEffect(() => {
    let cancelled = false
    const silent = pollTick > 0 && Boolean(autoRefreshMs)
    const timer = setTimeout(async () => {
      if (!silent) setLoading(true)
      setError(null)

      try {
        const [res, queueRes] = await Promise.all([
          query.trim() || Object.keys(filters).length
            ? window.judovac.searchJudokas(query, filters)
            : window.judovac.listJudokas({ limit: clientMode ? 500 : 1_000_000, offset: 0 }),
          clientMode ? window.judovac.getSyncQueue() : Promise.resolve(null)
        ])

        if (cancelled) return

        const pendingRaw: Judoka[] =
          queueRes && queueRes.ok
            ? (queueRes.data.items
                .filter((i) => i.operation === 'upsert')
                .map((i) => queueItemToJudoka(i))
                .filter(Boolean) as Judoka[])
            : []
        const pending =
          clientMode && clientUsername
            ? pendingRaw.filter(
                (j) => j.createdBy.trim().toLowerCase() === clientUsername.trim().toLowerCase()
              )
            : pendingRaw

        if (!res.ok) {
          if (pending.length > 0) {
            setError(`Serveur injoignable (${res.error}). Éléments en file locale affichés.`)
            setItems(pending)
          } else {
            setError(res.error)
            setItems([])
          }
          return
        }

        if (!clientMode && typeof res.data.total === 'number') {
          setSystemTotal(res.data.total)
        }

        let list = res.data.items
        if (clientMode && clientUsername) {
          list = list.filter(
            (j) => j.createdBy.trim().toLowerCase() === clientUsername.trim().toLowerCase()
          )
        }
        setItems([...pending, ...list])
      } finally {
        if (!cancelled && !silent) setLoading(false)
      }
    }, pollTick > 0 && autoRefreshMs ? 0 : 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (!silent) setLoading(false)
    }
  }, [query, filters, refreshKey, pollTick, clientMode, clientUsername, autoRefreshMs])

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll(): void {
    if (selected.size === items.length) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(items.map((j) => j.id)))
  }

  async function handleDelete(j: Judoka): Promise<void> {
    const label = clientMode
      ? `Mettre en file la suppression de ${formatJudokaFullName(j)} (${j.displayId}) ?`
      : `Supprimer définitivement ${formatJudokaFullName(j)} (${j.displayId}) ?`
    if (!window.confirm(label)) return
    const res = await window.judovac.deleteJudoka(j.id)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(
      clientMode
        ? `Suppression de ${j.displayId} mise en file de sync.`
        : `Judoka ${j.displayId} supprimé.`
    )
    reload()
  }

  async function exportSelected(): Promise<void> {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    const res = await window.judovac.exportBadgesPdf({
      judokaIds: Array.from(selected),
      perPage: 4
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(`${res.data.count} badge(s) exporté(s) → ${res.data.path}`)
  }

  function buildFilterSummaryParts(): string[] {
    const parts: string[] = []
    if (query.trim()) parts.push(`Recherche « ${query.trim()} »`)
    if (club) parts.push(`Club « ${club} »`)
    if (province) parts.push(`Province « ${province} »`)
    if (league) parts.push(`Ligue « ${league} »`)
    if (grade) parts.push(`Grade « ${grade} »`)
    if (createdBy) parts.push(`Utilisateur « ${createdBy} »`)
    return parts
  }

  async function loadJudokasForExport(): Promise<Judoka[]> {
    if (items.length > 0 && (clientMode || systemTotal == null || items.length >= systemTotal)) {
      return items
    }
    const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
    if (!res.ok) throw new Error(res.error)
    return res.data.items
  }

  async function exportListPdf(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const parts = buildFilterSummaryParts()
      const judokas = query.trim() || parts.length ? items : await loadJudokasForExport()
      const { downloadPdfBytes, exportJudokaListPdfBytes } = await import('@/lib/judoka-list-pdf')
      const bytes = await exportJudokaListPdfBytes({
        judokas,
        filterSummary: parts.length ? parts.join(' · ') : 'Aucun (tous les judokas affichés)'
      })
      const filename = `liste-judokas-${new Date().toISOString().slice(0, 10)}.pdf`
      downloadPdfBytes(bytes, filename)
      setMessage(`Liste exportée (${judokas.length} judoka(s)) → ${filename}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export liste impossible')
    } finally {
      setBusy(false)
    }
  }

  async function exportClubsPdf(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const parts = buildFilterSummaryParts()
      const judokas = query.trim() || parts.length ? items : await loadJudokasForExport()
      const { exportAndDownloadClubsListPdf } = await import('@/lib/clubs-list-pdf')
      const out = await exportAndDownloadClubsListPdf(
        judokas,
        parts.length ? parts.join(' · ') : 'Tous les judokas enregistrés'
      )
      setMessage(`Clubs exportés (${out.clubCount} club(s)) → ${out.filename}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export clubs impossible')
    } finally {
      setBusy(false)
    }
  }

  async function printSelected(): Promise<void> {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    const res = await window.judovac.printBadges({
      judokaIds: Array.from(selected),
      perPage: 4
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage(`${res.data.count} badge(s) envoyé(s) à l'imprimante.`)
  }

  return (
    <AppShell
      embedded={embedded}
      title="Liste des judokas"
      subtitle={
        clientMode
          ? 'Modification / suppression synchronisées via la file locale'
          : autoRefreshMs
            ? 'Recherche · actualisation automatique chaque seconde'
            : 'Recherche · sélection · export / impression'
      }
      actions={
        !embedded ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4 animate-fade-in">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Nom, prénom, licence, téléphone, ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Club" value={club} onChange={(e) => setClub(e.target.value)} />
          <Input
            placeholder="Province"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
          />
          <Input placeholder="Ligue" value={league} onChange={(e) => setLeague(e.target.value)} />
          <Input placeholder="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
          {!clientMode && (
            <div className="min-w-0 space-y-1">
              <Label htmlFor="filter-user" className="sr-only">
                Utilisateur
              </Label>
              <select
                id="filter-user"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
              >
                <option value="">Utilisateur (tous)</option>
                {creators.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {!clientMode && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white/70 px-3 py-2">
            <span className="text-sm text-muted-foreground">{selected.size} sélectionné(s)</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void exportSelected()}
            >
              <FileDown className="h-4 w-4" />
              Export PDF
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void printSelected()}
            >
              <Printer className="h-4 w-4" />
              Imprimer
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Recherche…</p>
        )}

        <div className="overflow-hidden rounded-xl border bg-white/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-judo-navy/5 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {!clientMode && (
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleAll}
                      aria-label="Tout sélectionner"
                    />
                  </th>
                )}
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Nom</th>
                <th className="px-3 py-2">Club</th>
                <th className="px-3 py-2">Grade</th>
                <th className="px-3 py-2">Catégorie</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading ? (
                <tr>
                  <td
                    colSpan={clientMode ? 6 : 7}
                    className="px-3 py-8 text-center text-muted-foreground"
                  >
                    Aucun résultat
                  </td>
                </tr>
              ) : (
                pageItems.map((j) => (
                  <tr key={j.id} className="border-b last:border-0 hover:bg-judo-mist/50">
                    {!clientMode && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(j.id)}
                          onChange={() => toggle(j.id)}
                          aria-label={`Sélectionner ${j.displayId}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 font-mono text-xs">{j.displayId}</td>
                    <td className="px-3 py-2 font-medium">{formatJudokaFullName(j)}</td>
                    <td className="px-3 py-2">{j.club || '—'}</td>
                    <td className="px-3 py-2">{j.grade || '—'}</td>
                    <td className="px-3 py-2">
                      {resolveJudokaCategory(j.birthDate, j.category) || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Modifier"
                          onClick={() => onEdit?.(j)}
                          disabled={!onEdit}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Supprimer"
                          onClick={() => void handleDelete(j)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {(items.length > 0 || !clientMode) && (
          <div className="flex flex-col gap-3 rounded-xl border bg-white/80 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="space-y-0.5 text-sm text-muted-foreground">
              {!clientMode && (
                <p className="font-medium text-judo-navy">
                  {systemTotal != null
                    ? `${systemTotal.toLocaleString('fr-FR')} judoka(s)`
                    : loading
                      ? 'Chargement…'
                      : '— judoka(s)'}
                </p>
              )}
              {items.length > 0 && (
                <p>
                  {clientMode
                    ? `${items.length.toLocaleString('fr-FR')} judoka(s)`
                    : systemTotal != null && items.length !== systemTotal
                      ? `${items.length.toLocaleString('fr-FR')} résultat(s) · `
                      : ''}
                  Page {pageIndex + 1} sur {pageCount}
                  {items.length > PAGE_SIZE && (
                    <span>
                      {' '}
                      (lignes {pageIndex * PAGE_SIZE + 1}–
                      {Math.min((pageIndex + 1) * PAGE_SIZE, items.length)})
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pageIndex <= 0 || items.length === 0}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                Précédent
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pageIndex >= pageCount - 1 || items.length === 0}
                onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              >
                Suivant
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!clientMode && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void exportListPdf()}
                    className="bg-emerald-600 px-4 text-white hover:bg-emerald-700 hover:text-white"
                  >
                    <FileDown className="h-4 w-4" />
                    Export Liste
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void exportClubsPdf()}
                    className="bg-emerald-600 px-4 text-white hover:bg-emerald-700 hover:text-white"
                  >
                    <FileDown className="h-4 w-4" />
                    Exporter Clubs
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function queueItemToJudoka(item: {
  id: string
  payload: unknown
  createdAt: string
}): Judoka | null {
  if (!item.payload || typeof item.payload !== 'object') return null
  const p = item.payload as Record<string, unknown>
  const lastName = String(p.lastName ?? '')
  const firstName = String(p.firstName ?? '')
  if (!lastName || !firstName) return null
  const birthDate = String(p.birthDate ?? '')
  const age = birthDate.match(/^\d{4}-\d{2}-\d{2}$/) ? computeAge(birthDate) : 0
  return {
    id: typeof p.id === 'string' ? p.id : `pending-${item.id}`,
    displayId: typeof p.displayId === 'string' ? p.displayId : 'Sync…',
    lastName,
    middleName: String(p.middleName ?? ''),
    firstName,
    sex: p.sex === 'F' ? 'F' : 'M',
    birthDate,
    age,
    province: String(p.province ?? ''),
    city: String(p.city ?? ''),
    commune: String(p.commune ?? ''),
    address: String(p.address ?? ''),
    phone: String(p.phone ?? ''),
    email: String(p.email ?? ''),
    club: String(p.club ?? ''),
    league: String(p.league ?? ''),
    sportProvince: String(p.sportProvince ?? ''),
    grade: String(p.grade ?? ''),
    belt: String(p.belt ?? ''),
    category: resolveJudokaCategory(birthDate, String(p.category ?? '')),
    weightKg: p.weightKg == null ? null : Number(p.weightKg),
    heightCm: p.heightCm == null ? null : Number(p.heightCm),
    licenseNumber: String(p.licenseNumber ?? ''),
    affiliationYear: p.affiliationYear == null ? null : Number(p.affiliationYear),
    photoPath: (p.photoPath as string | null) ?? null,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
    createdBy: String(p.createdBy ?? 'client'),
    createdWorkstation: String(p.createdWorkstation ?? ''),
    syncStatus: 'pending',
    version: 1
  }
}
