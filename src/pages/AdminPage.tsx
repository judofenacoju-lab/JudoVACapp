import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, Copy, Check, Eye, FileDown, ImagePlus, ListChecks, RefreshCw, Save, Trash2, Plus, Eraser, X } from 'lucide-react'
import type { AppSettings, CategoryAgeRange } from '@shared/types/settings'
import { createDefaultCategoryAgeRanges } from '@shared/types/settings'
import type { Judoka } from '@shared/types/judoka'
import {
  computeAge,
  formatJudokaFullName,
  hasRecordedWeight,
  resolveJudokaCategory
} from '@shared/utils/judoka'
import { mergeRegisteredClubNames, setActiveRegisteredClubs } from '@shared/utils/clubs'
import { withBrand, setActiveBrand } from '@shared/utils/branding'
import type { SystemLogEntry } from '@shared/types/dashboard'
import type { CreatedUserAccount, UserAccount } from '@shared/types/user-account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import {
  CategoryAgeSexChart,
  type AgeSexBar
} from '@/components/CategoryAgeSexChart'

interface Props {
  onBack: () => void
  embedded?: boolean
}

type Tab = 'event' | 'users' | 'clubs' | 'categories' | 'print' | 'colors' | 'network' | 'logs'

type ThresholdMode = 'eq' | 'gte' | 'lte'
type ThresholdDimension = 'age' | 'weight'

function judokaAgeYears(j: Judoka): number {
  if (j.age != null && Number.isFinite(j.age)) return Math.max(0, Math.floor(j.age))
  if (j.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(j.birthDate)) return computeAge(j.birthDate)
  return -1
}

function judokaWeightKg(j: Judoka): number {
  if (!hasRecordedWeight(j.weightKg)) return -1
  const n = Number(j.weightKg)
  return Number.isFinite(n) && n > 0 ? n : -1
}

function formatKg(n: number): string {
  return Number.isInteger(n) ? `${n} kg` : `${n.toFixed(1).replace('.', ',')} kg`
}

function AgeThresholdList({
  pool,
  threshold,
  mode,
  dimension
}: {
  pool: Judoka[]
  threshold: string
  mode: ThresholdMode
  dimension: ThresholdDimension
}) {
  const n = Number(String(threshold).replace(',', '.'))
  const hasThreshold = threshold.trim() !== '' && Number.isFinite(n)
  const items = hasThreshold
    ? pool.filter((j) => {
        const value = dimension === 'age' ? judokaAgeYears(j) : judokaWeightKg(j)
        if (value < 0) return false
        if (mode === 'eq') {
          return dimension === 'age' ? value === n : Math.abs(value - n) < 0.05
        }
        if (mode === 'gte') return value >= n
        return value <= n
      })
    : pool

  if (items.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
        {hasThreshold
          ? 'Aucun judoka de cette catégorie ne correspond à ce seuil.'
          : 'Aucun judoka dans cette catégorie.'}
      </p>
    )
  }

  const unit = dimension === 'age' ? 'ans' : 'kg'
  const label = dimension === 'age' ? 'âge' : 'poids'
  const cmp = mode === 'eq' ? '=' : mode === 'gte' ? '≥' : '≤'

  return (
    <>
      <p className="px-2 pb-2 text-xs text-muted-foreground">
        {items.length} judoka(s)
        {hasThreshold ? ` · ${label} ${cmp} ${n} ${unit}` : ''}
      </p>
      <ul className="space-y-1">
        {[...items]
          .sort((a, b) => {
            const va = dimension === 'age' ? judokaAgeYears(a) : judokaWeightKg(a)
            const vb = dimension === 'age' ? judokaAgeYears(b) : judokaWeightKg(b)
            if (va !== vb) return va - vb
            return formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
          })
          .map((j) => {
          const age = judokaAgeYears(j)
          const w = judokaWeightKg(j)
          return (
            <li key={j.id} className="rounded-lg border bg-white px-3 py-2.5 text-sm">
              <p className="font-medium text-judo-navy">{formatJudokaFullName(j)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[
                  j.displayId,
                  age >= 0 ? `${age} ans` : null,
                  w > 0 ? formatKg(w) : null,
                  j.sex === 'F' ? 'F' : 'M',
                  j.club?.trim() || null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          )
        })}
      </ul>
    </>
  )
}

interface LocalNetworkInfo {
  addresses: Array<{ address: string; iface: string }>
  preferredAddress: string | null
  port: number
}

/**
 * Panneau d'administration — événement, impression, couleurs, réseau, journal.
 */
export function AdminPage({ onBack, embedded = false }: Props) {
  const [tab, setTab] = useState<Tab>('event')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [logs, setLogs] = useState<SystemLogEntry[]>([])
  const [users, setUsers] = useState<UserAccount[]>([])
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [createdCredentials, setCreatedCredentials] = useState<CreatedUserAccount | null>(null)
  const [network, setNetwork] = useState<LocalNetworkInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [confirmClearClubs, setConfirmClearClubs] = useState(false)
  const [confirmDeleteUsers, setConfirmDeleteUsers] = useState(false)
  const [deleteUsersBusy, setDeleteUsersBusy] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [newClubName, setNewClubName] = useState('')
  /** Effectifs judokas par club (clé = nom en minuscules). */
  const [clubCounts, setClubCounts] = useState<Record<string, number>>({})
  const [categoriesListBusy, setCategoriesListBusy] = useState(false)
  /** Effectifs judokas par catégorie (clé = nom en minuscules). */
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [categoryViewName, setCategoryViewName] = useState<string | null>(null)
  const [categoryExportBusy, setCategoryExportBusy] = useState(false)
  const [categoryChart, setCategoryChart] = useState<{
    name: string
    range: CategoryAgeRange
  } | null>(null)
  const [categoryChartData, setCategoryChartData] = useState<AgeSexBar[]>([])
  const [categoryChartLoading, setCategoryChartLoading] = useState(false)
  const [categoryChartError, setCategoryChartError] = useState<string | null>(null)
  const [categoryChartYoungest, setCategoryChartYoungest] = useState<string | null>(null)
  const [categoryChartOldest, setCategoryChartOldest] = useState<string | null>(null)
  const [categoryChartLightest, setCategoryChartLightest] = useState<string | null>(null)
  const [categoryChartHeaviest, setCategoryChartHeaviest] = useState<string | null>(null)
  const [ageThresholdRow, setAgeThresholdRow] = useState<CategoryAgeRange | null>(null)
  const [ageThreshold, setAgeThreshold] = useState('')
  const [ageThresholdMode, setAgeThresholdMode] = useState<ThresholdMode>('gte')
  const [ageThresholdDimension, setAgeThresholdDimension] = useState<ThresholdDimension>('age')
  const [ageThresholdPool, setAgeThresholdPool] = useState<Judoka[]>([])
  const [ageThresholdLoading, setAgeThresholdLoading] = useState(false)
  const [ageThresholdError, setAgeThresholdError] = useState<string | null>(null)
  const [clubMembersClub, setClubMembersClub] = useState<string | null>(null)
  const [clubMembers, setClubMembers] = useState<Judoka[]>([])
  const [clubMembersLoading, setClubMembersLoading] = useState(false)
  const [clubMembersError, setClubMembersError] = useState<string | null>(null)
  const [clubMembersExportBusy, setClubMembersExportBusy] = useState(false)

  async function refreshClubCounts(): Promise<void> {
    const res = await window.judovac.listJudokaClubNames()
    if (!res.ok) return
    const map: Record<string, number> = {}
    for (const row of res.data.stats ?? []) {
      map[row.name.trim().toLowerCase()] = row.count
    }
    setClubCounts(map)
  }

  async function openClubMembers(clubName: string): Promise<void> {
    const target = clubName.trim()
    if (!target) return
    setClubMembersClub(target)
    setClubMembers([])
    setClubMembersError(null)
    setClubMembersLoading(true)
    try {
      const key = target.toLowerCase()
      const res = await window.judovac.searchJudokas('', { club: target })
      if (!res.ok) {
        setClubMembersError(res.error)
        setClubMembers([])
        return
      }
      const items = res.data.items
        .filter((j) => (j.club.trim() || 'Sans club').toLowerCase() === key)
        .sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
      setClubMembers(items)
    } catch (e) {
      setClubMembersError(e instanceof Error ? e.message : 'Chargement impossible')
      setClubMembers([])
    } finally {
      setClubMembersLoading(false)
    }
  }

  function closeClubMembers(): void {
    setClubMembersClub(null)
    setClubMembers([])
    setClubMembersError(null)
    setClubMembersLoading(false)
    setClubMembersExportBusy(false)
  }

  async function exportClubMembersPdf(): Promise<void> {
    if (!clubMembersClub || clubMembers.length === 0) return
    setClubMembersExportBusy(true)
    setClubMembersError(null)
    setMessage(null)
    try {
      const { downloadPdfBytes, exportJudokaListPdfBytes } = await import('@/lib/judoka-list-pdf')
      const bytes = await exportJudokaListPdfBytes({
        judokas: clubMembers,
        title: withBrand(`Club — ${clubMembersClub} — JudoVACapp`),
        filterSummary: `Club « ${clubMembersClub} »`,
        mode: 'registered'
      })
      const safe = clubMembersClub
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 48)
      const filename = `liste-club-${safe || 'club'}-${new Date().toISOString().slice(0, 10)}.pdf`
      downloadPdfBytes(bytes, filename)
      setMessage(`Liste du club « ${clubMembersClub} » exportée (${clubMembers.length} judoka(s)) → ${filename}`)
    } catch (e) {
      setClubMembersError(e instanceof Error ? e.message : 'Export PDF impossible')
    } finally {
      setClubMembersExportBusy(false)
    }
  }

  async function clearAllClubs(): Promise<void> {
    if (!settings) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await window.judovac.setSettings({ clubs: [] })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setActiveRegisteredClubs([])
      setSettings({ ...res.data, clubs: [] })
      setNewClubName('')
      setConfirmClearClubs(false)
      setMessage('Tous les clubs de Configuration ont été effacés. Les judokas enregistrés sont conservés.')
      void refreshClubCounts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Effacement des clubs impossible')
    } finally {
      setBusy(false)
    }
  }

  async function loadNetwork(): Promise<void> {
    const n = await window.judovac.getLocalNetworkInfo()
    if (n.ok) setNetwork(n.data)
  }

  async function loadUsers(): Promise<void> {
    const u = await window.judovac.listUsers()
    if (u.ok) setUsers(u.data.items)
  }

  async function loadLogs(): Promise<void> {
    const l = await window.judovac.getLogs(80)
    if (l.ok) setLogs(l.data.items)
  }

  useEffect(() => {
    void (async () => {
      const [s, l, u] = await Promise.all([
        window.judovac.getSettings(),
        window.judovac.getLogs(80),
        window.judovac.listUsers()
      ])
      if (s.ok) {
        setActiveRegisteredClubs(s.data.clubs)
        setSettings(s.data)
        void refreshClubCounts()
      } else {
        setError(s.error)
      }
      if (l.ok) setLogs(l.data.items)
      if (u.ok) setUsers(u.data.items)
      await loadNetwork()
    })()
  }, [])

  useEffect(() => {
    if (tab !== 'clubs') return
    void refreshClubCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- volontairement lié à l’onglet
  }, [tab])

  useEffect(() => {
    if (tab !== 'categories' || !settings) return
    let cancelled = false
    void (async () => {
      await refreshCategoryCounts()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- volontairement lié à l’onglet
  }, [tab])

  async function refreshCategoryCounts(): Promise<void> {
    if (!settings) return
    const ranges = settings.categories ?? createDefaultCategoryAgeRanges()
    const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
    if (!res.ok) return
    const map: Record<string, number> = {}
    for (const r of ranges) {
      const key = r.name.trim().toLowerCase()
      if (key) map[key] = 0
    }
    for (const j of res.data.items) {
      const cat =
        resolveJudokaCategory(j.birthDate, j.category, ranges) || j.category?.trim() || ''
      const key = cat.toLowerCase()
      if (!key) continue
      map[key] = (map[key] ?? 0) + 1
    }
    setCategoryCounts(map)
  }

  async function openCategoryChart(row: CategoryAgeRange): Promise<void> {
    const name = row.name.trim() || row.name
    setCategoryChart({ name, range: row })
    setCategoryChartData([])
    setCategoryChartYoungest(null)
    setCategoryChartOldest(null)
    setCategoryChartLightest(null)
    setCategoryChartHeaviest(null)
    setCategoryChartError(null)
    setCategoryChartLoading(true)
    try {
      const ranges = settings?.categories ?? createDefaultCategoryAgeRanges()
      const key = name.toLowerCase()
      const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
      if (!res.ok) {
        setCategoryChartError(res.error)
        return
      }
      const minA = Math.max(0, Math.floor(Number(row.minAge) || 0))
      const maxA = Math.max(minA, Math.floor(Number(row.maxAge) || minA))
      const byAge = new Map<number, { boys: number; girls: number }>()
      for (let a = minA; a <= maxA; a++) {
        byAge.set(a, { boys: 0, girls: 0 })
      }
      const withAge: Array<{ name: string; age: number }> = []
      const withWeight: Array<{ name: string; weight: number }> = []
      for (const j of res.data.items) {
        const cat =
          resolveJudokaCategory(j.birthDate, j.category, ranges) || j.category?.trim() || ''
        if (cat.toLowerCase() !== key) continue
        const nameLabel = formatJudokaFullName(j)
        const age = judokaAgeYears(j)
        const w = judokaWeightKg(j)
        if (w > 0) withWeight.push({ name: nameLabel, weight: w })
        if (age < 0) continue
        withAge.push({ name: nameLabel, age })
        const bucket = byAge.get(age) ?? { boys: 0, girls: 0 }
        if (j.sex === 'F') bucket.girls += 1
        else bucket.boys += 1
        byAge.set(age, bucket)
      }
      const bars: AgeSexBar[] = [...byAge.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([age, counts]) => ({ age, boys: counts.boys, girls: counts.girls }))
      setCategoryChartData(bars)
      if (withAge.length > 0) {
        const minAge = Math.min(...withAge.map((x) => x.age))
        const maxAge = Math.max(...withAge.map((x) => x.age))
        const youngest = withAge
          .filter((x) => x.age === minAge)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))[0]
        const oldest = withAge
          .filter((x) => x.age === maxAge)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))[0]
        setCategoryChartYoungest(youngest ? `${youngest.name} (${minAge} ans)` : null)
        setCategoryChartOldest(oldest ? `${oldest.name} (${maxAge} ans)` : null)
      }
      if (withWeight.length > 0) {
        const minW = Math.min(...withWeight.map((x) => x.weight))
        const maxW = Math.max(...withWeight.map((x) => x.weight))
        const lightest = withWeight
          .filter((x) => x.weight === minW)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))[0]
        const heaviest = withWeight
          .filter((x) => x.weight === maxW)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))[0]
        setCategoryChartLightest(lightest ? `${lightest.name} (${formatKg(minW)})` : null)
        setCategoryChartHeaviest(heaviest ? `${heaviest.name} (${formatKg(maxW)})` : null)
      }
    } catch (e) {
      setCategoryChartError(e instanceof Error ? e.message : 'Chargement impossible')
    } finally {
      setCategoryChartLoading(false)
    }
  }

  function closeCategoryChart(): void {
    setCategoryChart(null)
    setCategoryChartData([])
    setCategoryChartYoungest(null)
    setCategoryChartOldest(null)
    setCategoryChartLightest(null)
    setCategoryChartHeaviest(null)
    setCategoryChartError(null)
    setCategoryChartLoading(false)
  }

  async function openAgeThreshold(row: CategoryAgeRange): Promise<void> {
    setAgeThresholdRow(row)
    setAgeThreshold(String(row.minAge ?? ''))
    setAgeThresholdMode('gte')
    setAgeThresholdDimension('age')
    setAgeThresholdPool([])
    setAgeThresholdError(null)
    setAgeThresholdLoading(true)
    try {
      const ranges = settings?.categories ?? createDefaultCategoryAgeRanges()
      const key = (row.name.trim() || row.name).toLowerCase()
      const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
      if (!res.ok) {
        setAgeThresholdError(res.error)
        return
      }
      const pool = res.data.items
        .filter((j) => {
          const cat =
            resolveJudokaCategory(j.birthDate, j.category, ranges) || j.category?.trim() || ''
          return cat.toLowerCase() === key
        })
        .sort((a, b) => {
          const ageDiff = judokaAgeYears(a) - judokaAgeYears(b)
          if (ageDiff !== 0) return ageDiff
          return formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
        })
      setAgeThresholdPool(pool)
    } catch (e) {
      setAgeThresholdError(e instanceof Error ? e.message : 'Chargement impossible')
    } finally {
      setAgeThresholdLoading(false)
    }
  }

  function closeAgeThreshold(): void {
    setAgeThresholdRow(null)
    setAgeThresholdPool([])
    setAgeThresholdError(null)
    setAgeThresholdLoading(false)
    setAgeThresholdDimension('age')
  }

  async function exportCategoryJudokasPdf(mode: 'registered' | 'weighed'): Promise<void> {
    if (!categoryViewName || !settings) return
    setCategoryExportBusy(true)
    setError(null)
    setMessage(null)
    try {
      const ranges = settings.categories ?? createDefaultCategoryAgeRanges()
      const key = categoryViewName.trim().toLowerCase()
      const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
      if (!res.ok) {
        setError(res.error)
        return
      }
      let items = res.data.items.filter((j) => {
        const cat =
          resolveJudokaCategory(j.birthDate, j.category, ranges) || j.category?.trim() || ''
        return cat.toLowerCase() === key
      })
      if (mode === 'weighed') {
        items = items.filter((j) => hasRecordedWeight(j.weightKg))
      }
      items = [...items].sort((a, b) =>
        formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr')
      )

      const { downloadPdfBytes, exportJudokaListPdfBytes } = await import('@/lib/judoka-list-pdf')
      const bytes = await exportJudokaListPdfBytes({
        judokas: items,
        title:
          mode === 'weighed'
            ? withBrand(`Catégorie — ${categoryViewName} (pesés) — JudoVACapp`)
            : withBrand(`Catégorie — ${categoryViewName} (enregistrés) — JudoVACapp`),
        filterSummary:
          mode === 'weighed'
            ? `Catégorie « ${categoryViewName} » · judokas pesés uniquement`
            : `Catégorie « ${categoryViewName} » · tous les judokas enregistrés`,
        mode
      })
      const safe = categoryViewName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 48)
      const filename =
        mode === 'weighed'
          ? `liste-categorie-${safe || 'cat'}-peses-${new Date().toISOString().slice(0, 10)}.pdf`
          : `liste-categorie-${safe || 'cat'}-enregistres-${new Date().toISOString().slice(0, 10)}.pdf`
      downloadPdfBytes(bytes, filename)
      setCategoryViewName(null)
      setMessage(
        mode === 'weighed'
          ? `Catégorie « ${categoryViewName} » (pesés) : ${items.length} judoka(s) → ${filename}`
          : `Catégorie « ${categoryViewName} » (enregistrés) : ${items.length} judoka(s) → ${filename}`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export catégorie impossible')
    } finally {
      setCategoryExportBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!settings) return
    setBusy(true)
    setError(null)
    const categories = (settings.categories ?? []).map((r) => ({
      name: r.name.trim(),
      minAge: Number(r.minAge),
      maxAge: Number(r.maxAge)
    }))
    for (const r of categories) {
      if (!r.name) {
        setBusy(false)
        setError('Chaque catégorie doit avoir un nom.')
        setTab('categories')
        return
      }
      if (!Number.isFinite(r.minAge) || !Number.isFinite(r.maxAge) || r.minAge > r.maxAge) {
        setBusy(false)
        setError(`Tranche invalide pour « ${r.name} » (âge min ≤ âge max).`)
        setTab('categories')
        return
      }
    }
    const clubs = mergeRegisteredClubNames(settings.clubs)
    const payload = { ...settings, categories, clubs }
    const res = await window.judovac.setSettings(payload)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSettings(res.data)
    setActiveBrand(res.data.event.name, res.data.event.logoDataUrl)
    setMessage('Paramètres enregistrés.')
    void refreshClubCounts()
    void refreshCategoryCounts()
  }

  async function exportCategoriesListPdf(): Promise<void> {
    if (!settings) return
    setCategoriesListBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
      if (!res.ok) {
        setError(res.error)
        return
      }
      const { exportAndDownloadCategoriesListPdf } = await import('@/lib/categories-list-pdf')
      const out = await exportAndDownloadCategoriesListPdf(
        res.data.items,
        settings.categories ?? createDefaultCategoryAgeRanges()
      )
      setMessage(
        `Liste catégories exportée (${out.categoryCount} catégorie(s)) → ${out.filename}`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export liste catégories impossible')
    } finally {
      setCategoriesListBusy(false)
    }
  }

  function addClubRow(): void {
    if (!settings) return
    const name = newClubName.trim()
    if (!name) {
      setError('Indiquez un nom de club.')
      setTab('clubs')
      return
    }
    setError(null)
    setSettings({
      ...settings,
      clubs: mergeRegisteredClubNames([...(settings.clubs ?? []), name])
    })
    setNewClubName('')
  }

  async function createUser(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const username = newUsername.trim()
      if (!username) {
        setError("Indiquez un nom d'utilisateur (ex. orient).")
        return
      }
      if (newPassword.trim() && newPassword.trim().length < 6) {
        setError('Le mot de passe doit contenir au moins 6 caractères.')
        return
      }
      const res = await window.judovac.createUser(
        username,
        undefined,
        newPassword.trim() || undefined
      )
      if (!res.ok) {
        setError(res.error)
        return
      }
      setNewUsername('')
      setNewPassword('')
      setCreatedCredentials(res.data)
      setMessage(`Compte « ${res.data.username} » créé.`)
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible')
    } finally {
      setBusy(false)
    }
  }

  function isProtectedAdmin(user: UserAccount): boolean {
    return (
      user.role === 'admin' ||
      user.username.toLowerCase() === 'admin' ||
      user.username === 'Serveur'
    )
  }

  function openResetPassword(username: string): void {
    setResetError(null)
    setResetPassword('')
    setResetTarget(username)
  }

  async function confirmResetPassword(): Promise<void> {
    if (!resetTarget) return
    setResetBusy(true)
    setResetError(null)
    setMessage(null)
    const pwd = resetPassword.trim()
    if (pwd && pwd.length < 6) {
      setResetBusy(false)
      setResetError('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }
    const res = await window.judovac.resetUserPassword(resetTarget, pwd || undefined)
    setResetBusy(false)
    if (!res.ok) {
      setResetError(res.error)
      return
    }
    setResetTarget(null)
    setResetPassword('')
    setCreatedCredentials(res.data)
    setMessage(`Mot de passe de « ${res.data.username} » réinitialisé.`)
    await loadUsers()
  }

  async function removeUser(username: string): Promise<void> {
    setDeleteError(null)
    setDeleteTarget(username)
  }

  async function confirmDeleteUser(): Promise<void> {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(null)
    setMessage(null)
    const res = await window.judovac.deleteUser(deleteTarget)
    setDeleteBusy(false)
    if (!res.ok) {
      setDeleteError(res.error)
      return
    }
    setMessage(`Compte « ${deleteTarget} » supprimé.`)
    setDeleteTarget(null)
    await loadUsers()
  }

  async function confirmDeleteAllUsers(): Promise<void> {
    const targets = users.filter((u) => !isProtectedAdmin(u))
    if (targets.length === 0) {
      setConfirmDeleteUsers(false)
      setMessage('Aucun compte utilisateur à supprimer (le compte Serveur est conservé).')
      return
    }
    setDeleteUsersBusy(true)
    setError(null)
    setMessage(null)
    try {
      let deleted = 0
      for (const user of targets) {
        const res = await window.judovac.deleteUser(user.username)
        if (!res.ok) {
          setError(res.error)
          await loadUsers()
          return
        }
        deleted += 1
      }
      setConfirmDeleteUsers(false)
      setMessage(
        deleted === 1
          ? '1 compte utilisateur a été supprimé. Le compte Serveur (Admin) est conservé.'
          : `${deleted} comptes utilisateurs ont été supprimés. Le compte Serveur (Admin) est conservé.`
      )
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suppression des utilisateurs impossible')
    } finally {
      setDeleteUsersBusy(false)
    }
  }

  async function loadEventLogo(file: File | undefined): Promise<void> {
    if (!settings || !file) return
    setBusy(true)
    setError(null)
    try {
      const logoDataUrl = await readLogoDataUrl(file)
      setSettings({ ...settings, event: { ...settings.event, logoDataUrl } })
      setMessage('Logo chargé. Cliquez sur Enregistrer pour l’appliquer à tous les comptes.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement du logo impossible')
    } finally {
      setBusy(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  async function clearLogs(): Promise<void> {
    if (!window.confirm('Effacer tout l’historique du journal ?')) return
    setBusy(true)
    setError(null)
    const res = await window.judovac.clearLogs()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage('Journal effacé.')
    await loadLogs()
  }

  async function copyText(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Impossible de copier dans le presse-papiers.')
    }
  }

  if (!settings) {
    return (
      <AppShell embedded={embedded} title="Configuration">
        <p className="text-sm text-muted-foreground">{error ?? 'Chargement…'}</p>
      </AppShell>
    )
  }

  const displayPort = settings.network.serverPort || network?.port || 3847
  const preferred = network?.preferredAddress

  return (
    <AppShell
      embedded={embedded}
      title="Configuration"
      subtitle="Événement · Utilisateurs · Clubs · Catégorie · Impression · Couleurs · Réseau · Journal"
      actions={
        !embedded ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['event', 'Événement'],
              ['users', 'Utilisateurs'],
              ['clubs', 'Clubs'],
              ['categories', 'Catégorie'],
              ['print', 'Impression'],
              ['colors', 'Couleurs'],
              ['network', 'Réseau'],
              ['logs', 'Journal']
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              variant={tab === id ? 'accent' : 'outline'}
              size="sm"
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        {tab === 'event' && (
          <section className="grid gap-4 rounded-xl border bg-white/75 p-5 sm:grid-cols-2">
            <Field label="Nom de l'événement">
              <Input
                placeholder="JudoVACapp"
                value={settings.event.name}
                onChange={(e) =>
                  setSettings({ ...settings, event: { ...settings.event, name: e.target.value } })
                }
              />
              <p className="text-xs text-muted-foreground">
                Une fois enregistré, ce nom remplace « JudoVACapp » dans les menus et les documents.
                Laissez vide pour conserver JudoVACapp.
              </p>
            </Field>
            <Field label="Type">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-white/80 px-3 text-sm"
                value={settings.event.type}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: {
                      ...settings.event,
                      type: e.target.value as AppSettings['event']['type']
                    }
                  })
                }
              >
                <option value="competition">Compétition</option>
                <option value="exam">Examen</option>
                <option value="stage">Stage</option>
                <option value="other">Autre</option>
              </select>
            </Field>
            <Field label="Lieu">
              <Input
                value={settings.event.location}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, location: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="Organisateur">
              <Input
                value={settings.event.organizer}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, organizer: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="Date début">
              <Input
                type="date"
                value={settings.event.startDate}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, startDate: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="Date fin">
              <Input
                type="date"
                value={settings.event.endDate}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, endDate: e.target.value }
                  })
                }
              />
            </Field>
            <div className="sm:col-span-2 space-y-2">
              <Label>Logo de l’activité</Label>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void loadEventLogo(e.target.files?.[0])}
              />
              <div className="flex flex-wrap items-center gap-3">
                <img
                  src={settings.event.logoDataUrl?.trim() || undefined}
                  alt=""
                  className={`h-14 w-14 rounded-full object-cover ring-2 ring-judo-navy/20 ${
                    settings.event.logoDataUrl?.trim() ? '' : 'hidden'
                  }`}
                />
                {!settings.event.logoDataUrl?.trim() && (
                  <span className="text-sm text-muted-foreground">
                    Aucun logo chargé — le logo JudoVAC reste affiché dans les menus.
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => logoInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  Charger logo
                </Button>
                {settings.event.logoDataUrl?.trim() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        event: { ...settings.event, logoDataUrl: null }
                      })
                    }
                  >
                    Retirer
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        )}

        {tab === 'users' && (
          <section className="space-y-4 rounded-xl border bg-white/75 p-5">
            <p className="text-sm text-muted-foreground">
              Saisissez un nom (ex. <span className="font-mono text-foreground">orient</span>) — l’email
              de connexion sera{' '}
              <span className="font-mono text-foreground">orient@mail.com</span>. Vous pouvez aussi
              coller directement l’email.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom d'utilisateur">
                <Input
                  placeholder="Ex. orient"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void createUser()
                    }
                  }}
                />
              </Field>
              <Field label="Mot de passe (min. 6 caractères)">
                <Input
                  type="text"
                  placeholder="Laisser vide = généré automatiquement"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void createUser()
                    }
                  }}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="accent"
                disabled={busy || !newUsername.trim()}
                onClick={() => void createUser()}
              >
                <Plus className="h-4 w-4" />
                {busy ? 'Création…' : 'Créer le compte'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || deleteUsersBusy || users.every((u) => isProtectedAdmin(u))}
                onClick={() => {
                  setError(null)
                  setMessage(null)
                  setConfirmDeleteUsers(true)
                }}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {message && <p className="text-sm text-emerald-700">{message}</p>}
            <ul className="max-h-80 space-y-2 overflow-auto text-sm">
              {users.length === 0 && (
                <li className="text-muted-foreground">Aucun compte pour l’instant.</li>
              )}
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium text-judo-navy">
                      {user.username}
                      {isProtectedAdmin(user) && (
                        <span className="ml-2 rounded bg-judo-navy/10 px-1.5 py-0.5 text-xs font-normal text-judo-navy">
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {user.email ?? `${user.username.toLowerCase()}@mail.com`}
                      {' · '}
                      Créé le {new Date(user.createdAt).toLocaleString('fr-FR')}
                      {user.active ? '' : ' · inactif'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Réinitialiser le mot de passe"
                      disabled={busy || resetBusy}
                      onClick={() => openResetPassword(user.username)}
                    >
                      <RefreshCw className="h-4 w-4 text-judo-navy" />
                      <span className="sr-only">Réinitialiser</span>
                    </Button>
                    {!isProtectedAdmin(user) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busy}
                        onClick={() => void removeUser(user.username)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Supprimer
                      </Button>
                    ) : (
                      <span className="px-2 text-xs text-muted-foreground">Non supprimable</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'clubs' && (
          <section className="space-y-4 rounded-xl border bg-white/75 p-5">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1 space-y-2">
                <Label htmlFor="new-club">Nouveau club</Label>
                <Input
                  id="new-club"
                  placeholder="Ex. Judo Club Kinshasa"
                  value={newClubName}
                  onChange={(e) => setNewClubName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addClubRow()
                    }
                  }}
                />
              </div>
              <Button type="button" variant="outline" onClick={() => addClubRow()} disabled={busy}>
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>
            <ul className="space-y-2 border-t border-border/60 pt-4">
              {(settings.clubs ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">
                  Aucun club pour l’instant. Ajoutez-en un ci-dessus.
                </li>
              )}
              {(settings.clubs ?? []).map((name, index) => {
                const count = clubCounts[name.trim().toLowerCase()] ?? 0
                return (
                  <li key={`${name}-${index}`} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="min-w-[12rem] flex-1"
                      value={name}
                      onChange={(e) => {
                        const clubs = [...(settings.clubs ?? [])]
                        clubs[index] = e.target.value
                        setSettings({ ...settings, clubs })
                      }}
                    />
                    <button
                      type="button"
                      disabled={count === 0}
                      onClick={() => void openClubMembers(name)}
                      className="shrink-0 rounded-md border bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-judo-navy transition hover:border-judo-navy/40 hover:bg-judo-navy/5 disabled:cursor-default disabled:opacity-60"
                      title={
                        count === 0
                          ? 'Aucun judoka dans ce club'
                          : 'Voir la liste des judokas de ce club'
                      }
                    >
                      {count} judoka{count !== 1 ? 's' : ''}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Retirer de la liste"
                      onClick={() => {
                        const clubs = (settings.clubs ?? []).filter((_, i) => i !== index)
                        setSettings({ ...settings, clubs })
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {tab === 'categories' && (
          <section className="space-y-4 rounded-xl border bg-white/75 p-5">
            <p className="text-sm text-muted-foreground">
              Définissez les tranches d’âge utilisées pour attribuer automatiquement la catégorie
              d’un judoka (formulaire et liste).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Catégorie</th>
                    <th className="px-2 py-2 w-28">Âge min</th>
                    <th className="px-2 py-2 w-28">Âge max</th>
                    <th className="px-2 py-2 w-28 text-center">Judokas</th>
                    <th className="px-2 py-2 w-40" />
                  </tr>
                </thead>
                <tbody>
                  {(settings.categories ?? createDefaultCategoryAgeRanges()).map((row, index) => {
                    const count = categoryCounts[row.name.trim().toLowerCase()] ?? 0
                    return (
                    <tr key={`${row.name}-${index}`} className="border-b last:border-0">
                      <td className="px-2 py-2">
                        <Input
                          value={row.name}
                          onChange={(e) => {
                            const categories = [...(settings.categories ?? [])]
                            categories[index] = { ...categories[index], name: e.target.value }
                            setSettings({ ...settings, categories })
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={row.minAge}
                          onChange={(e) => {
                            const categories = [...(settings.categories ?? [])]
                            categories[index] = {
                              ...categories[index],
                              minAge: Number(e.target.value)
                            }
                            setSettings({ ...settings, categories })
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={row.maxAge}
                          onChange={(e) => {
                            const categories = [...(settings.categories ?? [])]
                            categories[index] = {
                              ...categories[index],
                              maxAge: Number(e.target.value)
                            }
                            setSettings({ ...settings, categories })
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span
                          className="inline-block rounded-md border bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-judo-navy"
                          title="Judokas enregistrés dans cette catégorie"
                        >
                          {count}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Supprimer"
                            disabled={(settings.categories ?? []).length <= 1}
                            onClick={() => {
                              const categories = (settings.categories ?? []).filter(
                                (_, i) => i !== index
                              )
                              setSettings({ ...settings, categories })
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Voir / exporter les judokas de cette catégorie"
                            onClick={() => setCategoryViewName(row.name.trim() || row.name)}
                          >
                            <Eye className="h-4 w-4 text-judo-navy" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Graphique garçons / filles par âge"
                            onClick={() => void openCategoryChart(row)}
                          >
                            <BarChart3 className="h-4 w-4 text-judo-navy" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Seuil d’âge ou de poids — liste des judokas"
                            onClick={() => void openAgeThreshold(row)}
                          >
                            <ListChecks className="h-4 w-4 text-judo-navy" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings({
                    ...settings,
                    categories: [
                      ...(settings.categories ?? []),
                      { name: 'Nouvelle', minAge: 0, maxAge: 0 }
                    ]
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Ajouter une catégorie
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings({
                    ...settings,
                    categories: createDefaultCategoryAgeRanges()
                  })
                }
              >
                <RefreshCw className="h-4 w-4" />
                Restaurer les défauts
              </Button>
            </div>
          </section>
        )}

        {tab === 'print' && (
          <section className="grid gap-4 rounded-xl border bg-white/75 p-5 sm:grid-cols-2">
            <Field label="Imprimante par défaut (nom exact)">
              <Input
                value={settings.print.defaultPrinter}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    print: { ...settings.print, defaultPrinter: e.target.value }
                  })
                }
                placeholder="Laisser vide = dialogue système"
              />
            </Field>
            <Field label="Copies">
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.print.copies}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    print: { ...settings.print, copies: Number(e.target.value) || 1 }
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={settings.print.silent}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    print: { ...settings.print, silent: e.target.checked }
                  })
                }
              />
              Impression silencieuse (sans dialogue)
            </label>
          </section>
        )}

        {tab === 'colors' && (
          <section className="grid gap-4 rounded-xl border bg-white/75 p-5 sm:grid-cols-2">
            <Field label="Couleur primaire">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.ui.primaryColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, primaryColor: e.target.value }
                    })
                  }
                />
                <Input
                  value={settings.ui.primaryColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, primaryColor: e.target.value }
                    })
                  }
                />
              </div>
            </Field>
            <Field label="Couleur accent">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.ui.accentColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, accentColor: e.target.value }
                    })
                  }
                />
                <Input
                  value={settings.ui.accentColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, accentColor: e.target.value }
                    })
                  }
                />
              </div>
            </Field>
          </section>
        )}

        {tab === 'network' && (
          <section className="space-y-5 rounded-xl border bg-white/75 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-judo-navy">Adresse IP du serveur</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Communiquez cette adresse aux postes clients pour qu’ils se connectent.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadNetwork()}
              >
                <RefreshCw className="h-4 w-4" />
                Actualiser
              </Button>
            </div>

            <div className="rounded-lg border border-judo-navy/15 bg-judo-navy/[0.04] p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                IP à noter pour les clients
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="font-mono text-3xl font-semibold tracking-tight text-judo-navy">
                  {preferred ?? 'Non détectée'}
                </p>
                {preferred && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText(preferred)}
                  >
                    {copied === preferred ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied === preferred ? 'Copiée' : 'Copier'}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Port : <span className="font-mono text-foreground">{displayPort}</span>
                {preferred && (
                  <>
                    {' '}
                    · Connexion client :{' '}
                    <span className="font-mono text-foreground">
                      {preferred}:{displayPort}
                    </span>
                  </>
                )}
              </p>
              {preferred && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 px-0"
                  onClick={() => void copyText(`${preferred}:${displayPort}`)}
                >
                  {copied === `${preferred}:${displayPort}` ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copier IP:port
                </Button>
              )}
            </div>

            {network && network.addresses.length > 1 && (
              <div>
                <p className="mb-2 text-sm font-medium text-judo-navy">
                  Autres adresses détectées
                </p>
                <ul className="space-y-2 text-sm">
                  {network.addresses
                    .filter((a) => a.address !== preferred)
                    .map((a) => (
                      <li
                        key={`${a.iface}-${a.address}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/80 px-3 py-2"
                      >
                        <span>
                          <span className="font-mono">{a.address}</span>
                          <span className="ml-2 text-muted-foreground">({a.iface})</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void copyText(a.address)}
                        >
                          {copied === a.address ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {!network?.addresses.length && (
              <p className="text-sm text-amber-800">
                Aucune adresse IPv4 LAN détectée. Vérifiez que le poste est connecté au réseau
                local, puis actualisez.
              </p>
            )}

            <Field label="Port réseau serveur">
              <Input
                type="number"
                value={settings.network.serverPort}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    network: { ...settings.network, serverPort: Number(e.target.value) || 3847 }
                  })
                }
              />
            </Field>
          </section>
        )}

        {tab === 'logs' && (
          <section className="space-y-4 rounded-xl border bg-white/75 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-judo-navy">Journal système</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || logs.length === 0}
                onClick={() => void clearLogs()}
              >
                <Eraser className="h-4 w-4" />
                Effacer
              </Button>
            </div>
            <ul className="max-h-[28rem] space-y-2 overflow-auto text-sm">
              {logs.length === 0 && (
                <li className="text-muted-foreground">Aucune entrée journal.</li>
              )}
              {logs.map((log) => (
                <li key={log.id} className="border-b border-border/50 pb-2 last:border-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-judo-navy">
                      [{log.level}] {log.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{log.message}</p>
                  {(log.actor || log.workstation) && (
                    <p className="text-xs text-muted-foreground">
                      {log.actor}
                      {log.workstation ? ` @ ${log.workstation}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab !== 'logs' && tab !== 'users' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="accent" size="lg" disabled={busy} onClick={() => void save()}>
              <Save className="h-4 w-4" />
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
            {tab === 'clubs' && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={busy || (settings.clubs ?? []).length === 0}
                onClick={() => {
                  setError(null)
                  setMessage(null)
                  setConfirmClearClubs(true)
                }}
              >
                <Eraser className="h-4 w-4" />
                Effacer
              </Button>
            )}
            {tab === 'categories' && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={busy || categoriesListBusy || !settings}
                onClick={() => void exportCategoriesListPdf()}
              >
                <FileDown className="h-4 w-4" />
                {categoriesListBusy ? 'Export…' : 'Liste'}
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
      </div>

      {confirmDeleteUsers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-users-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="delete-users-title" className="text-lg font-semibold text-judo-navy">
              Supprimer les utilisateurs
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Tous les comptes utilisateurs seront supprimés, sauf le compte Serveur (Admin).
              Cette action est irréversible.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteUsersBusy}
                onClick={() => setConfirmDeleteUsers(false)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteUsersBusy}
                onClick={() => void confirmDeleteAllUsers()}
              >
                {deleteUsersBusy ? 'Suppression…' : 'Supprimer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmClearClubs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-clubs-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="clear-clubs-title" className="text-lg font-semibold text-judo-navy">
              Effacer les clubs
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Tous les clubs enregistrés dans Configuration seront retirés de la liste. Les noms et
              données des judokas restent inchangés.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmClearClubs(false)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void clearAllClubs()}
              >
                {busy ? 'Effacement…' : 'Effacer les clubs'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {createdCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="credentials-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="credentials-title" className="text-lg font-semibold text-judo-navy">
              {createdCredentials.password && message?.includes('réinitialisé')
                ? 'Mot de passe réinitialisé'
                : 'Compte créé — identifiants de connexion'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Communiquez ces informations à{' '}
              <strong>{createdCredentials.username}</strong> pour qu’il puisse se connecter.
            </p>
            <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-mono font-medium">{createdCredentials.email}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText(createdCredentials.email)}
                >
                  {copied === createdCredentials.email ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Mot de passe</p>
                  <p className="font-mono font-medium">{createdCredentials.password}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText(createdCredentials.password)}
                >
                  {copied === createdCredentials.password ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="button" variant="accent" onClick={() => setCreatedCredentials(null)}>
                Fermer
              </Button>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="reset-password-title" className="text-lg font-semibold text-judo-navy">
              Réinitialiser le mot de passe
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Compte <strong>{resetTarget}</strong> — le mot de passe actuel n’est pas demandé.
              Laissez vide pour générer un mot de passe automatiquement.
            </p>
            <div className="mt-4">
              <Label htmlFor="reset-new-password">Nouveau mot de passe</Label>
              <Input
                id="reset-new-password"
                type="text"
                className="mt-1"
                placeholder="Min. 6 caractères ou vide = généré"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void confirmResetPassword()
                  }
                }}
              />
            </div>
            {resetError && <p className="mt-3 text-sm text-destructive">{resetError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={resetBusy}
                onClick={() => {
                  setResetTarget(null)
                  setResetPassword('')
                  setResetError(null)
                }}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={resetBusy}
                onClick={() => void confirmResetPassword()}
              >
                {resetBusy ? 'Réinitialisation…' : 'Réinitialiser'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="delete-user-title" className="text-lg font-semibold text-judo-navy">
              Supprimer « {deleteTarget} » ?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Ce compte ne pourra plus se connecter. Les judokas enregistrés par cet utilisateur
              restent dans la base.
            </p>

            {deleteError && <p className="mt-3 text-sm text-destructive">{deleteError}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteUser()}
              >
                {deleteBusy ? 'Suppression…' : 'Supprimer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {categoryChart && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Fermer"
            onClick={closeCategoryChart}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-chart-title"
            className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2
                  id="category-chart-title"
                  className="font-display text-lg font-semibold text-judo-navy"
                >
                  Graphique — {categoryChart.name}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Garçons et filles par âge ({categoryChart.range.minAge}–
                  {categoryChart.range.maxAge} ans)
                </p>
                {!categoryChartLoading && !categoryChartError && (
                  <div className="mt-2 space-y-0.5 text-sm">
                    <p>
                      <span className="text-muted-foreground">Plus jeune : </span>
                      <span className="font-medium text-judo-navy">
                        {categoryChartYoungest ?? '—'}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Plus âgé : </span>
                      <span className="font-medium text-judo-navy">
                        {categoryChartOldest ?? '—'}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Pèse moins : </span>
                      <span className="font-medium text-judo-navy">
                        {categoryChartLightest ?? '—'}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Pèse plus : </span>
                      <span className="font-medium text-judo-navy">
                        {categoryChartHeaviest ?? '—'}
                      </span>
                    </p>
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={closeCategoryChart}
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-4">
              {categoryChartLoading && (
                <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
              )}
              {categoryChartError && (
                <p className="text-sm text-destructive">{categoryChartError}</p>
              )}
              {!categoryChartLoading && !categoryChartError && (
                <CategoryAgeSexChart
                  data={categoryChartData}
                  categoryName={categoryChart.name}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {ageThresholdRow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Fermer"
            onClick={closeAgeThreshold}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-judo-navy">
                  {ageThresholdDimension === 'age' ? 'Seuil d’âge' : 'Seuil de poids'} —{' '}
                  {ageThresholdRow.name}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Checking par {ageThresholdDimension === 'age' ? 'âge' : 'poids'}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={closeAgeThreshold}
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="space-y-3 border-b px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={ageThresholdDimension === 'age' ? 'accent' : 'outline'}
                  onClick={() => {
                    setAgeThresholdDimension('age')
                    setAgeThreshold(String(ageThresholdRow.minAge ?? ''))
                  }}
                >
                  Par âge
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={ageThresholdDimension === 'weight' ? 'accent' : 'outline'}
                  onClick={() => {
                    setAgeThresholdDimension('weight')
                    setAgeThreshold('')
                  }}
                >
                  Par poids
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="age-threshold">
                    {ageThresholdDimension === 'age' ? 'Seuil (ans)' : 'Seuil (kg)'}
                  </Label>
                  <Input
                    id="age-threshold"
                    type="number"
                    min={0}
                    max={ageThresholdDimension === 'age' ? 120 : 300}
                    step={ageThresholdDimension === 'age' ? 1 : 0.1}
                    value={ageThreshold}
                    onChange={(e) => setAgeThreshold(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="age-threshold-mode">Comparaison</Label>
                  <select
                    id="age-threshold-mode"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={ageThresholdMode}
                    onChange={(e) => setAgeThresholdMode(e.target.value as ThresholdMode)}
                  >
                    {ageThresholdDimension === 'age' ? (
                      <>
                        <option value="eq">Âge = seuil</option>
                        <option value="gte">Âge ≥ seuil</option>
                        <option value="lte">Âge ≤ seuil</option>
                      </>
                    ) : (
                      <>
                        <option value="eq">Poids = seuil</option>
                        <option value="gte">Poids ≥ seuil</option>
                        <option value="lte">Poids ≤ seuil</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-auto px-3 py-3">
              {ageThresholdLoading && (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">Chargement…</p>
              )}
              {ageThresholdError && (
                <p className="px-2 text-sm text-destructive">{ageThresholdError}</p>
              )}
              {!ageThresholdLoading && !ageThresholdError && (
                <AgeThresholdList
                  pool={ageThresholdPool}
                  threshold={ageThreshold}
                  mode={ageThresholdMode}
                  dimension={ageThresholdDimension}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {categoryViewName && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onClick={() => {
            if (!categoryExportBusy) setCategoryViewName(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-view-title"
            className="w-full max-w-md rounded-xl border bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2
                  id="category-view-title"
                  className="font-display text-lg font-semibold text-judo-navy"
                >
                  Catégorie — {categoryViewName}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Télécharger la liste des judokas de cette catégorie
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={categoryExportBusy}
                onClick={() => setCategoryViewName(null)}
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:justify-center">
              <Button
                type="button"
                size="lg"
                disabled={categoryExportBusy}
                className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white"
                onClick={() => void exportCategoryJudokasPdf('registered')}
              >
                <FileDown className="h-4 w-4" />
                {categoryExportBusy ? 'Export…' : 'Voir Enregistrés'}
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={categoryExportBusy}
                className="flex-1 bg-judo-navy text-white hover:bg-judo-navy/90 hover:text-white"
                onClick={() => void exportCategoryJudokasPdf('weighed')}
              >
                <FileDown className="h-4 w-4" />
                {categoryExportBusy ? 'Export…' : 'Voir Pesés'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {clubMembersClub && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Fermer"
            onClick={closeClubMembers}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="club-members-title"
            className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2
                  id="club-members-title"
                  className="font-display text-lg font-semibold text-judo-navy"
                >
                  Club — {clubMembersClub}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {clubMembersLoading
                    ? 'Chargement…'
                    : `${clubMembers.length} judoka(s)`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    clubMembersLoading ||
                    clubMembersExportBusy ||
                    clubMembers.length === 0
                  }
                  className="bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white"
                  onClick={() => void exportClubMembersPdf()}
                >
                  <FileDown className="h-4 w-4" />
                  {clubMembersExportBusy ? 'Export…' : 'Export PDF'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={closeClubMembers}
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto px-3 py-3">
              {clubMembersError && (
                <p className="px-2 text-sm text-destructive">{clubMembersError}</p>
              )}
              {!clubMembersLoading && !clubMembersError && clubMembers.length === 0 && (
                <p className="px-2 text-sm text-muted-foreground">
                  Aucun judoka pour ce club.
                </p>
              )}
              <ul className="space-y-1">
                {clubMembers.map((j) => {
                  const category = resolveJudokaCategory(j.birthDate, j.category)
                  return (
                    <li
                      key={j.id}
                      className="rounded-lg border bg-white px-3 py-2.5 text-sm"
                    >
                      <p className="font-medium text-judo-navy">{formatJudokaFullName(j)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          j.displayId,
                          j.sex === 'F' ? 'F' : 'M',
                          category || null,
                          j.weightKg != null ? `${j.weightKg} kg` : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function readLogoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const max = 256
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas indisponible'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image illisible'))
    }
    img.src = url
  })
}
