import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Dices, FileDown, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import { CombatBracket } from '@/components/CombatBracket'
import {
  createWeightClassId,
  DEFAULT_TIRAGE_SETTINGS,
  formatTirageCategoryName,
  generateTirage,
  normalizeWeightClasses,
  suggestWeightClassLabel,
  type TirageResult,
  type TirageWeightClass
} from '@shared/utils/tirage'
import { mergeTirageIntoCombatSession, listTatamisWithoutCombats, isCombatSchedulableOnTatami } from '@shared/types/combats'
import { getActiveCategoryNames } from '@shared/utils/judoka'
import { TirageTeamPanel } from '@/components/TirageTeamPanel'
import {
  TirageCeremonyModal,
  namesFromIndividualTirage,
  pairsFromIndividualTirage
} from '@/components/TirageCeremonyModal'

interface Props {
  onBack: () => void
  embedded?: boolean
}

function emptyWeightClass(partial?: Partial<TirageWeightClass>): TirageWeightClass {
  const maxKg = partial?.maxKg ?? 20
  const minKg = partial?.minKg ?? Math.max(0, maxKg - 2)
  return {
    id: createWeightClassId(),
    label: partial?.label ?? suggestWeightClassLabel(maxKg),
    minKg,
    maxKg
  }
}

/**
 * Tirage des combats — catégories de poids configurables, grilles à élimination directe.
 */
export function TiragePage({ onBack, embedded = false }: Props) {
  const [weightClasses, setWeightClasses] = useState<TirageWeightClass[]>([
    emptyWeightClass({ minKg: 18, maxKg: 20, label: '-20 kg' })
  ])
  const [avoidSameClub, setAvoidSameClub] = useState(DEFAULT_TIRAGE_SETTINGS.avoidSameClub)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sexFilter, setSexFilter] = useState<'' | 'M' | 'F'>('')
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [result, setResult] = useState<TirageResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [sendBusy, setSendBusy] = useState(false)
  /** Tatamis déjà créés sur la page Combats (requis pour activer l’envoi). */
  const [tatamiCount, setTatamiCount] = useState(0)
  const [mode, setMode] = useState<'individual' | 'team'>('individual')
  const [ceremony, setCeremony] = useState<{
    names: string[]
    pairs: ReturnType<typeof pairsFromIndividualTirage>
    pending: TirageResult
  } | null>(null)

  async function refreshTatamiCount(): Promise<number> {
    const settingsRes = await window.judovac.getSettings()
    if (!settingsRes.ok) {
      setTatamiCount(0)
      return 0
    }
    const n = settingsRes.data.combatSession?.tatamis?.length ?? 0
    setTatamiCount(n)
    return n
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const settingsRes = await window.judovac.getSettings()
      if (cancelled) return
      if (settingsRes.ok) {
        setCategories(
          settingsRes.data.categories.map((c) => c.name).filter(Boolean).length > 0
            ? settingsRes.data.categories.map((c) => c.name)
            : getActiveCategoryNames()
        )
        const saved = normalizeWeightClasses(settingsRes.data.weightClasses ?? [])
        if (saved.length > 0) setWeightClasses(saved)
        setTatamiCount(settingsRes.data.combatSession?.tatamis?.length ?? 0)
      } else {
        setCategories(getActiveCategoryNames())
        setTatamiCount(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function persistWeightClasses(classes: TirageWeightClass[]): Promise<void> {
    const normalized = normalizeWeightClasses(classes)
    await window.judovac.setSettings({ weightClasses: normalized })
  }

  const visiblePools = useMemo(() => {
    if (!result) return []
    return result.pools.filter((p) => {
      if (sexFilter && p.sex !== sexFilter) return false
      if (categoryFilter && formatTirageCategoryName(p.category) !== formatTirageCategoryName(categoryFilter)) {
        return false
      }
      return true
    })
  }, [result, sexFilter, categoryFilter])

  function updateWeightClass(id: string, patch: Partial<TirageWeightClass>): void {
    setWeightClasses((rows) =>
      rows.map((row) => {
        if (row.id !== id) return row
        const next = { ...row, ...patch }
        if (patch.maxKg != null && /^-\s*[\d.,]+\s*kg$/i.test(row.label.trim())) {
          next.label = suggestWeightClassLabel(Number(patch.maxKg) || 0)
        }
        return next
      })
    )
  }

  function addWeightClass(): void {
    setWeightClasses((rows) => {
      const last = rows[rows.length - 1]
      const prevMax = last?.maxKg ?? 18
      const nextMax = prevMax + 2
      return [
        ...rows,
        emptyWeightClass({
          minKg: prevMax,
          maxKg: nextMax,
          label: suggestWeightClassLabel(nextMax)
        })
      ]
    })
  }

  function removeWeightClass(id: string): void {
    setWeightClasses((rows) => rows.filter((r) => r.id !== id))
  }

  async function runTirage(): Promise<void> {
    setLoading(true)
    setError(null)
    setExportMessage(null)
    try {
      const normalized = normalizeWeightClasses(weightClasses)
      setWeightClasses(normalized)
      await persistWeightClasses(normalized)

      const listed = await window.judovac.listJudokas({ limit: 5000, offset: 0 })
      if (!listed.ok) {
        setError(listed.error)
        setResult(null)
        return
      }
      const generated = generateTirage(listed.data.items, {
        weightClasses: normalized,
        avoidSameClub,
        sexFilter: normalized.length === 0 ? sexFilter : '',
        categoryFilter: normalized.length === 0 ? categoryFilter : ''
      })
      if (generated.weighedCount === 0) {
        setResult(null)
        setError('Aucun judoka pesé à tirer. Enregistrez d’abord les poids.')
        return
      }
      if (generated.matchedCount === 0) {
        setResult(generated)
        setError(
          normalized.length === 0
            ? 'Aucun judoka pesé ne correspond aux filtres Afficher / catégorie d’âge.'
            : `Aucun judoka pesé ne correspond aux catégories de poids définies (${generated.weighedCount} pesé(s) hors seuils).`
        )
        return
      }

      setCeremony({
        names: namesFromIndividualTirage(generated),
        pairs: pairsFromIndividualTirage(generated),
        pending: generated
      })
      await refreshTatamiCount()
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : 'Tirage impossible')
    } finally {
      setLoading(false)
    }
  }

  async function sendToCombats(): Promise<void> {
    if (!result || result.matchedCount === 0) return
    setSendBusy(true)
    setError(null)
    setExportMessage(null)
    try {
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const existing = settingsRes.data.combatSession ?? null
      const n = existing?.tatamis?.length ?? 0
      setTatamiCount(n)
      if (n === 0) {
        setError(
          'Créez d’abord au moins un tatami dans le menu Combats, puis renvoyez les combats.'
        )
        return
      }
      if (
        existing?.confirmedAt &&
        !window.confirm(
          'Une session Combats confirmée existe déjà. L’envoi remplacera les combats (les tatamis sont conservés). Continuer ?'
        )
      ) {
        return
      }
      const next = mergeTirageIntoCombatSession(existing, result)
      const empty = listTatamisWithoutCombats(next)
      if (empty.length > 0) {
        const assignable = next.combats.filter(isCombatSchedulableOnTatami).length
        setError(
          `Impossible d’envoyer : ${empty.length} tatami(s) resteraient sans combat (${assignable} combat(s) des tours 1–2 pour ${n} tatami(s) : ${empty.map((t) => t.name).join(', ')}). Supprimez des tatamis sur Combats, puis renvoyez.`
        )
        return
      }
      const saved = await window.judovac.setSettings({ combatSession: next })
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      setTatamiCount(saved.data.combatSession?.tatamis?.length ?? n)
      setExportMessage(
        `${result.fightCount} combat(s) envoyés — tours 1 et 2 classés sur ${n} tatami(s). Confirmez sur Combats.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi vers Combats impossible')
    } finally {
      setSendBusy(false)
    }
  }

  async function exportGrille(): Promise<void> {
    if (visiblePools.length === 0) {
      setExportMessage(null)
      setError('Aucune grille visible à exporter pour ces filtres.')
      return
    }
    setExportBusy(true)
    setError(null)
    setExportMessage(null)
    try {
      const { exportAndDownloadTirageBracketPdf } = await import('@/lib/tirage-bracket-pdf')
      const out = await exportAndDownloadTirageBracketPdf(visiblePools)
      setExportMessage(`Grille exportée (${out.poolCount} tableau(x)) → ${out.filename}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export PDF impossible')
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <AppShell
      embedded={embedded}
      title="Tirage"
      subtitle={
        mode === 'team'
          ? 'Tirage par club : rencontres d’équipes selon les catégories des judokas.'
          : 'Classement aléatoire des combats par sexe, catégorie d’âge, catégories de poids.'
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
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="lg"
            variant={mode === 'individual' ? 'accent' : 'outline'}
            onClick={() => setMode('individual')}
          >
            Individuel
          </Button>
          <Button
            type="button"
            size="lg"
            variant={mode === 'team' ? 'accent' : 'outline'}
            onClick={() => setMode('team')}
          >
            Par équipe
          </Button>
        </div>

        {mode === 'team' && (
          <TirageTeamPanel tatamiCount={tatamiCount} onTatamiCount={setTatamiCount} />
        )}

        {mode === 'individual' && (
        <>
        <div className="rounded-xl border bg-white/75 p-5 space-y-5 max-w-3xl">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label>Catégories de poids (libellés)</Label>
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={addWeightClass}>
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>

            <div className="space-y-2">
              {weightClasses.length === 0 && (
                <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  Aucune catégorie de poids : le tirage utilisera Même club, Afficher et Filtrer
                  catégorie d’âge (groupes par sexe × catégorie d’âge).
                </p>
              )}
              {weightClasses.map((row, index) => (
                <div
                  key={row.id}
                  className="grid gap-2 rounded-lg border bg-slate-50/80 p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto]"
                >
                  <div className="space-y-1">
                    <Label htmlFor={`wc-label-${row.id}`} className="text-xs text-muted-foreground">
                      Libellé {index + 1}
                    </Label>
                    <Input
                      id={`wc-label-${row.id}`}
                      value={row.label}
                      placeholder="-20 kg"
                      disabled={loading}
                      onChange={(e) => updateWeightClass(row.id, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`wc-min-${row.id}`} className="text-xs text-muted-foreground">
                      Min (kg)
                    </Label>
                    <Input
                      id={`wc-min-${row.id}`}
                      type="number"
                      min={0}
                      step={0.5}
                      value={row.minKg}
                      disabled={loading}
                      onChange={(e) =>
                        updateWeightClass(row.id, { minKg: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`wc-max-${row.id}`} className="text-xs text-muted-foreground">
                      Max (kg)
                    </Label>
                    <Input
                      id={`wc-max-${row.id}`}
                      type="number"
                      min={0}
                      step={0.5}
                      value={row.maxKg}
                      disabled={loading}
                      onChange={(e) =>
                        updateWeightClass(row.id, { maxKg: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={loading}
                      title="Supprimer cette catégorie"
                      onClick={() => removeWeightClass(row.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tirage-same-club">Même club</Label>
            <label
              htmlFor="tirage-same-club"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
            >
              <input
                id="tirage-same-club"
                type="checkbox"
                className="h-4 w-4 accent-judo-red"
                checked={avoidSameClub}
                onChange={(e) => setAvoidSameClub(e.target.checked)}
                disabled={loading}
              />
              Éviter les combats intra-club si possible
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tirage-sex">Afficher</Label>
              <select
                id="tirage-sex"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={sexFilter}
                onChange={(e) => setSexFilter(e.target.value as '' | 'M' | 'F')}
              >
                <option value="">Garçons et filles</option>
                <option value="M">Garçons seulement</option>
                <option value="F">Filles seulement</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tirage-cat">Filtrer catégorie d’âge</Label>
              <select
                id="tirage-cat"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">Toutes les catégories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="accent"
              size="lg"
              disabled={loading || ceremony !== null}
              onClick={() => void runTirage()}
            >
              {result ? <RefreshCw className="h-4 w-4" /> : <Dices className="h-4 w-4" />}
              {loading || ceremony
                ? 'Tirage…'
                : result
                  ? 'Relancer le tirage'
                  : 'Lancer le tirage'}
            </Button>
            {result && result.matchedCount > 0 && (
              <Button
                variant="accent"
                size="lg"
                disabled={loading || sendBusy || tatamiCount === 0 || ceremony !== null}
                title={
                  tatamiCount === 0
                    ? 'Créez d’abord des tatamis dans le menu Combats'
                    : 'Envoyer les combats vers la page Combats'
                }
                onClick={() => void sendToCombats()}
              >
                <Send className="h-4 w-4" />
                {sendBusy ? 'Envoi…' : 'Envoyer Combats'}
              </Button>
            )}
            {result && (
              <Button
                variant="outline"
                size="lg"
                disabled={loading || exportBusy || sendBusy || ceremony !== null}
                onClick={() => {
                  setResult(null)
                  setError(null)
                  setExportMessage(null)
                }}
              >
                Effacer
              </Button>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {exportMessage && <p className="text-sm text-emerald-700 break-all">{exportMessage}</p>}
          {result && result.matchedCount > 0 && (
            <>
              <p className="text-sm text-emerald-700">
                {result.matchedCount} pesé(s) classé(s) · {result.fightCount} combat(s)
                {result.byeCount > 0
                  ? ` · ${result.byeCount} bye(s) (passage au 2ᵉ tour)`
                  : ''}
                {result.unmatchedCount > 0
                  ? ` · ${result.unmatchedCount} hors catégories de poids`
                  : ''}
              </p>
              {tatamiCount === 0 ? (
                <p className="text-sm text-amber-800">
                  « Envoyer Combats » est inactif : créez d’abord au moins un tatami dans le menu{' '}
                  <strong>Combats</strong>, puis revenez ici.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {tatamiCount} tatami(s) prêt(s) sur Combats — vous pouvez envoyer les combats.
                </p>
              )}
            </>
          )}
        </div>

        {result && visiblePools.length === 0 && result.matchedCount > 0 && (
          <p className="text-sm text-muted-foreground">
            Aucun groupe ne correspond aux filtres d’affichage.
          </p>
        )}

        {visiblePools.map((pool) => (
          <section
            key={`${pool.sex}-${pool.category}-${pool.weightClassId}`}
            className="rounded-xl border bg-white/80 overflow-hidden"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-judo-navy/95 px-4 py-3 text-white">
              <div>
                <h3 className="font-display text-base font-semibold">
                  {pool.sexLabel} · {pool.category} · {pool.weightLabel}
                </h3>
                <p className="text-xs text-white/70">
                  {pool.entrantCount} judoka{pool.entrantCount > 1 ? 's' : ''} · tableau{' '}
                  {pool.bracket.size}
                </p>
              </div>
            </header>
            <div className="bg-slate-50/50 p-2">
              <CombatBracket bracket={pool.bracket} />
            </div>
          </section>
        ))}

        {visiblePools.length > 0 && (
          <div className="flex justify-center border-t pt-4 pb-2">
            <Button
              variant="accent"
              size="lg"
              disabled={exportBusy}
              onClick={() => void exportGrille()}
            >
              <FileDown className="h-4 w-4" />
              {exportBusy ? 'Export…' : 'Exporter Grille'}
            </Button>
          </div>
        )}
        </>
        )}
      </div>
      {ceremony && (
        <TirageCeremonyModal
          open
          kind="individual"
          names={ceremony.names}
          pairs={ceremony.pairs}
          onFinished={() => {
            setResult(ceremony.pending)
            setCeremony(null)
          }}
        />
      )}
    </AppShell>
  )
}
