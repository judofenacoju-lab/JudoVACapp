import { useEffect, useMemo, useRef, useState } from 'react'
import { Dices, FileDown, FileUp, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CombatBracket } from '@/components/CombatBracket'
import { normalizeTeams, teamDisplayName, type Team } from '@shared/types/teams'
import type { Sex } from '@shared/types/judoka'
import type { TeamWeightClassRange } from '@shared/types/settings'
import {
  generateTeamTirage,
  judoVacancesWeightClasses,
  mergeTeamTirageIntoCombatSession,
  normalizeTeamWeightClasses,
  teamMatchesToBracket,
  type TeamTirageResult
} from '@shared/utils/team-tirage'
import { createWeightClassId, suggestWeightClassLabel } from '@shared/utils/tirage'
import { listTatamisWithoutCombats, isCombatSchedulableOnTatami } from '@shared/types/combats'

interface Props {
  tatamiCount: number
  onTatamiCount: (n: number) => void
}

function emptyTeamWeightClass(partial?: Partial<TeamWeightClassRange>): TeamWeightClassRange {
  const maxKg = partial?.maxKg ?? 20
  const minKg = partial?.minKg ?? Math.max(0, maxKg - 2)
  return {
    id: createWeightClassId(),
    label: partial?.label ?? suggestWeightClassLabel(maxKg),
    minKg,
    maxKg,
    sex: partial?.sex === 'F' ? 'F' : 'M'
  }
}

/**
 * Tirage par club : toutes les équipes validées (même sans judoka), 1 combat par catégorie.
 */
export function TirageTeamPanel({ tatamiCount, onTatamiCount }: Props) {
  const [teams, setTeams] = useState<Team[]>([])
  const [weightClasses, setWeightClasses] = useState<TeamWeightClassRange[]>([
    emptyTeamWeightClass({ minKg: 18, maxKg: 20, label: '-20 kg', sex: 'M' })
  ])
  const [loading, setLoading] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<TeamTirageResult | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await window.judovac.getSettings()
      if (cancelled || !res.ok) return
      setTeams(normalizeTeams(res.data.teams))
      const saved = normalizeTeamWeightClasses(res.data.teamWeightClasses ?? [])
      if (saved.length > 0) setWeightClasses(saved)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function persistWeightClasses(classes: TeamWeightClassRange[]): Promise<void> {
    const normalized = normalizeTeamWeightClasses(classes)
    await window.judovac.setSettings({ teamWeightClasses: normalized })
  }

  function updateWeightClass(id: string, patch: Partial<TeamWeightClassRange>): void {
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
        emptyTeamWeightClass({
          minKg: prevMax,
          maxKg: nextMax,
          label: suggestWeightClassLabel(nextMax),
          sex: last?.sex ?? 'M'
        })
      ]
    })
  }

  function removeWeightClass(id: string): void {
    setWeightClasses((rows) => rows.filter((r) => r.id !== id))
  }

  async function applyJudoVacancesPreset(): Promise<void> {
    if (
      weightClasses.length > 0 &&
      !window.confirm('Remplacer les catégories actuelles par -60, -66, -73, -81, -90, +90 kg ?')
    ) {
      return
    }
    const next = judoVacancesWeightClasses('M')
    setWeightClasses(next)
    await persistWeightClasses(next)
  }

  async function run(): Promise<void> {
    setLoading(true)
    setError(null)
    setMessage(null)
    setExportMessage(null)
    try {
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const registered = normalizeTeams(settingsRes.data.teams)
      setTeams(registered)
      const normalized = normalizeTeamWeightClasses(weightClasses)
      setWeightClasses(normalized)
      await persistWeightClasses(normalized)
      if (normalized.length === 0) {
        setResult(null)
        setError(
          'Ajoutez au moins une catégorie de poids (libellé + sexe) avant de lancer le tirage par équipe.'
        )
        return
      }
      if (registered.length < 2) {
        setResult(null)
        setError(
          'Validez au moins deux équipes (menu Par Équipe → Équipes validées) avant le tirage.'
        )
        return
      }
      const listed = await window.judovac.listJudokas({ limit: 5000, offset: 0 })
      if (!listed.ok) {
        setError(listed.error)
        return
      }
      const generated = generateTeamTirage(registered, listed.data.items, normalized)
      if (generated.teamCount < 2) {
        setResult(generated)
        setError(
          'Validez au moins deux équipes (menu Par Équipe → Équipes validées) avant le tirage.'
        )
        return
      }
      if (generated.matchCount === 0) {
        setResult(generated)
        setError('Aucune rencontre générée. Vérifiez les équipes validées.')
        return
      }
      setResult(generated)
      if (generated.boutCount === 0) {
        setMessage(
          'Tirage effectué. Les combats contre un club sans judoka sont programmés : confirmez la victoire manuellement (absence).'
        )
      }
      onTatamiCount(settingsRes.data.combatSession?.tatamis?.length ?? 0)
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : 'Tirage par équipe impossible')
    } finally {
      setLoading(false)
    }
  }

  async function send(): Promise<void> {
    if (!result || result.boutCount === 0) return
    setSendBusy(true)
    setError(null)
    setMessage(null)
    try {
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const existing = settingsRes.data.combatSession ?? null
      const n = existing?.tatamis?.length ?? 0
      onTatamiCount(n)
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
      const next = mergeTeamTirageIntoCombatSession(existing, result.session)
      const empty = listTatamisWithoutCombats(next)
      if (empty.length > 0) {
        const assignable = next.combats.filter(isCombatSchedulableOnTatami).length
        setError(
          `Impossible d’envoyer : ${empty.length} tatami(s) resteraient sans combat (${assignable} combat(s) pour ${n} tatami(s)).`
        )
        return
      }
      const saved = await window.judovac.setSettings({ combatSession: next })
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      onTatamiCount(saved.data.combatSession?.tatamis?.length ?? n)
      setMessage(
        `${result.boutCount} combat(s) par équipe envoyés sur ${n} tatami(s). Confirmez sur Combats.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi vers Combats impossible')
    } finally {
      setSendBusy(false)
    }
  }

  async function exportGrille(): Promise<void> {
    if (!result || result.matchCount === 0) {
      setError('Aucune grille à exporter.')
      return
    }
    setExportBusy(true)
    setError(null)
    setExportMessage(null)
    try {
      const { exportAndDownloadTeamTiragePdf } = await import('@/lib/team-tirage-pdf')
      const out = await exportAndDownloadTeamTiragePdf(result, {
        teams,
        weightClasses
      })
      setExportMessage(`Grille exportée (${out.matchCount} rencontre(s)) → ${out.filename}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export PDF impossible')
    } finally {
      setExportBusy(false)
    }
  }

  async function importGrille(file: File | undefined): Promise<void> {
    if (!file) return
    setImportBusy(true)
    setLoading(true)
    setError(null)
    setMessage(null)
    setExportMessage(null)
    try {
      if (!/\.pdf$/i.test(file.name) && file.type && file.type !== 'application/pdf') {
        setError('Choisissez un fichier PDF de grille par équipe.')
        return
      }
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const registered = normalizeTeams(settingsRes.data.teams)
      setTeams(registered)
      const normalized = normalizeTeamWeightClasses(
        settingsRes.data.teamWeightClasses?.length
          ? settingsRes.data.teamWeightClasses
          : weightClasses
      )
      if (normalized.length > 0) setWeightClasses(normalized)
      const listed = await window.judovac.listJudokas({ limit: 5000, offset: 0 })
      if (!listed.ok) {
        setError(listed.error)
        return
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { importTeamTirageFromPdf } = await import('@/lib/team-tirage-import')
      const imported = await importTeamTirageFromPdf(
        bytes,
        registered,
        listed.data.items,
        normalized
      )
      setResult(imported)
      setMessage(
        `Tirage importé depuis « ${file.name} » · ${imported.teamCount} équipes · ${imported.matchCount} rencontre(s) · ${imported.boutCount} combat(s).`
      )
      onTatamiCount(settingsRes.data.combatSession?.tatamis?.length ?? 0)
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : 'Import PDF impossible')
    } finally {
      setImportBusy(false)
      setLoading(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const matches = result?.session.teamMatches?.filter((m) => m.round === 0) ?? []
  const validated = teams.filter((t) => t.club.trim())
  const teamBracket = useMemo(
    () => teamMatchesToBracket(result?.session.teamMatches ?? []),
    [result]
  )

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-3xl">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Catégories de poids (libellés)</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void applyJudoVacancesPreset()}
              >
                Judo Vacances
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={loading} onClick={addWeightClass}>
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            La grille n’affiche que les rencontres de clubs (Blanc vs Bleu). Les judokas
            principaux par catégorie apparaissent dans Combats après l’envoi.
          </p>
          <div className="space-y-2">
            {weightClasses.length === 0 && (
              <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                Aucune catégorie de poids : ajoutez-en au moins une (libellé, sexe, min/max kg).
              </p>
            )}
            {weightClasses.map((row, index) => (
              <div
                key={row.id}
                className="grid gap-2 rounded-lg border bg-slate-50/80 p-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]"
              >
                <div className="space-y-1">
                  <Label htmlFor={`twc-label-${row.id}`} className="text-xs text-muted-foreground">
                    Libellé {index + 1}
                  </Label>
                  <Input
                    id={`twc-label-${row.id}`}
                    value={row.label}
                    placeholder="-66 kg"
                    disabled={loading}
                    onChange={(e) => updateWeightClass(row.id, { label: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`twc-sex-${row.id}`} className="text-xs text-muted-foreground">
                    Sexe
                  </Label>
                  <select
                    id={`twc-sex-${row.id}`}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={row.sex}
                    disabled={loading}
                    onChange={(e) =>
                      updateWeightClass(row.id, { sex: e.target.value as Sex })
                    }
                  >
                    <option value="M">Garçons</option>
                    <option value="F">Filles</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`twc-min-${row.id}`} className="text-xs text-muted-foreground">
                    Min (kg)
                  </Label>
                  <Input
                    id={`twc-min-${row.id}`}
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
                  <Label htmlFor={`twc-max-${row.id}`} className="text-xs text-muted-foreground">
                    Max (kg)
                  </Label>
                  <Input
                    id={`twc-max-${row.id}`}
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

        <p className="text-sm text-muted-foreground border-t pt-4">
          {validated.length} équipe(s) validée(s). Toutes participent au tirage, y compris les clubs
          sans judoka. Face à un club avec judokas, le combat est programmé : la victoire par
          absence se confirme manuellement.
        </p>
        {teams.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {teams.map((t) => (
              <li
                key={t.id}
                className="rounded-full border bg-slate-50 px-3 py-1 text-xs text-judo-navy"
              >
                {teamDisplayName(t)} · {t.judokaIds.length}
                {t.judokaIds.length === 0 ? ' (sans judoka)' : ''}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <input
            ref={importInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => void importGrille(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="lg"
            disabled={loading || importBusy}
            onClick={() => importInputRef.current?.click()}
          >
            <FileUp className="h-4 w-4" />
            {importBusy ? 'Import…' : 'Import'}
          </Button>
          <Button variant="accent" size="lg" disabled={loading} onClick={() => void run()}>
            {result ? <RefreshCw className="h-4 w-4" /> : <Dices className="h-4 w-4" />}
            {loading && !importBusy
              ? 'Tirage…'
              : result
                ? 'Relancer le tirage'
                : 'Lancer le tirage par équipe'}
          </Button>
          {result && result.boutCount > 0 && (
            <Button
              variant="accent"
              size="lg"
              disabled={loading || sendBusy || tatamiCount === 0}
              title={
                tatamiCount === 0
                  ? 'Créez d’abord des tatamis dans le menu Combats'
                  : 'Envoyer les combats vers la page Combats'
              }
              onClick={() => void send()}
            >
              <Send className="h-4 w-4" />
              {sendBusy ? 'Envoi…' : 'Envoyer Combats'}
            </Button>
          )}
          {result && (
            <Button
              variant="outline"
              size="lg"
              disabled={loading || exportBusy || sendBusy}
              onClick={() => {
                setResult(null)
                setError(null)
                setMessage(null)
                setExportMessage(null)
              }}
            >
              Effacer
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Import : PDF de grille par équipe (Exporter Grille). Les combats du fichier s’affichent
          comme un nouveau tirage.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {exportMessage && <p className="text-sm text-emerald-700 break-all">{exportMessage}</p>}
        {result && result.matchCount > 0 && (
          <p className="text-sm text-emerald-700">
            {result.teamCount} équipes · {result.matchCount} rencontre(s) · {result.boutCount}{' '}
            combat(s)
          </p>
        )}
        {tatamiCount === 0 && result && result.boutCount > 0 && (
          <p className="text-sm text-amber-800">
            « Envoyer Combats » est inactif : créez d’abord un tatami dans <strong>Combats</strong>.
          </p>
        )}
      </div>

      {result && result.matchCount > 0 && teamBracket.rounds.length > 0 && (
        <section className="rounded-xl border bg-white/80 overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-judo-navy/95 px-4 py-3 text-white">
            <div>
              <h3 className="font-display text-base font-semibold">Tableau des équipes</h3>
              <p className="text-xs text-white/70">
                {result.teamCount} équipe{result.teamCount > 1 ? 's' : ''} · {result.matchCount}{' '}
                rencontre{result.matchCount > 1 ? 's' : ''} · tableau {teamBracket.size}
              </p>
            </div>
          </header>
          <div className="bg-slate-50/50 p-2">
            <CombatBracket bracket={teamBracket} palette="team" />
          </div>
        </section>
      )}

      {result && result.matchCount > 0 && matches.length > 0 && (
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
    </div>
  )
}
