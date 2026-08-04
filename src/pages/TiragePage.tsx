import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Dices, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import {
  DEFAULT_TIRAGE_SETTINGS,
  generateTirage,
  type TirageResult,
  type TirageSettings
} from '@shared/utils/tirage'
import { getActiveCategoryNames } from '@shared/utils/judoka'

interface Props {
  onBack: () => void
  embedded?: boolean
}

/**
 * Tirage des combats — judokas pesés uniquement, séparés garçons / filles,
 * groupés par catégorie et poids, appariés aléatoirement.
 */
export function TiragePage({ onBack, embedded = false }: Props) {
  const [settings, setSettings] = useState<TirageSettings>(DEFAULT_TIRAGE_SETTINGS)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sexFilter, setSexFilter] = useState<'' | 'M' | 'F'>('')
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TirageResult | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      } else {
        setCategories(getActiveCategoryNames())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const visiblePools = useMemo(() => {
    if (!result) return []
    return result.pools.filter((p) => {
      if (sexFilter && p.sex !== sexFilter) return false
      if (categoryFilter && p.category !== categoryFilter) return false
      return true
    })
  }, [result, sexFilter, categoryFilter])

  async function runTirage(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const listed = await window.judovac.listJudokas({ limit: 5000, offset: 0 })
      if (!listed.ok) {
        setError(listed.error)
        setResult(null)
        return
      }
      const generated = generateTirage(listed.data.items, settings)
      if (generated.weighedCount === 0) {
        setResult(null)
        setError('Aucun judoka pesé à tirer. Enregistrez d’abord les poids.')
        return
      }
      setResult(generated)
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : 'Tirage impossible')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell
      embedded={embedded}
      title="Tirage"
      subtitle="Classement aléatoire des combats — sexe, catégorie, poids (pesés uniquement)"
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
        <div className="rounded-xl border bg-white/75 p-5 space-y-5 max-w-3xl">
          <p className="text-sm text-muted-foreground">
            Les garçons combattent entre eux, les filles entre elles. Seuls les judokas avec un poids
            enregistré sont inclus. L’appariement est aléatoire au sein de chaque groupe
            (sexe × catégorie × poids).
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tirage-tolerance">Tolérance de poids (kg)</Label>
              <Input
                id="tirage-tolerance"
                type="number"
                min={0}
                step={0.5}
                value={settings.weightToleranceKg}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    weightToleranceKg: Math.max(0, Number(e.target.value) || 0)
                  }))
                }
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                0 = poids identiques (à 0,1 kg). Ex. 2 regroupe ±2 kg.
              </p>
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
                  checked={settings.avoidSameClub}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, avoidSameClub: e.target.checked }))
                  }
                  disabled={loading}
                />
                Éviter les combats intra-club si possible
              </label>
            </div>
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
              <Label htmlFor="tirage-cat">Filtrer catégorie</Label>
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
            <Button variant="accent" size="lg" disabled={loading} onClick={() => void runTirage()}>
              {result ? <RefreshCw className="h-4 w-4" /> : <Dices className="h-4 w-4" />}
              {loading ? 'Tirage…' : result ? 'Relancer le tirage' : 'Lancer le tirage'}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && (
            <p className="text-sm text-emerald-700">
              {result.weighedCount} pesé(s) · {result.fightCount} combat(s) · {result.byeCount}{' '}
              exempt(s)
            </p>
          )}
        </div>

        {result && visiblePools.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucun groupe ne correspond aux filtres d’affichage.
          </p>
        )}

        {visiblePools.map((pool) => (
          <section
            key={`${pool.sex}-${pool.category}-${pool.weightKey}`}
            className="rounded-xl border bg-white/80 overflow-hidden"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-judo-navy/95 px-4 py-3 text-white">
              <div>
                <h3 className="font-display text-base font-semibold">
                  {pool.sexLabel} · {pool.category} · {pool.weightLabel}
                </h3>
                <p className="text-xs text-white/70">
                  {pool.entrantCount} judoka{pool.entrantCount > 1 ? 's' : ''} · {pool.fights.length}{' '}
                  match{pool.fights.length > 1 ? 's' : ''}
                </p>
              </div>
            </header>
            <ul className="divide-y">
              {pool.fights.map((fight) => (
                <li
                  key={fight.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm sm:gap-4"
                >
                  <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                    #{fight.number}
                  </span>
                  <div className="min-w-0 flex-1 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <FighterCard
                      name={fight.a.name}
                      club={fight.a.club}
                      weight={fight.a.weightKg}
                      side="A"
                    />
                    <span className="text-center text-xs font-semibold uppercase tracking-wide text-judo-red">
                      {fight.bye ? 'Exempt' : 'vs'}
                    </span>
                    {fight.b ? (
                      <FighterCard
                        name={fight.b.name}
                        club={fight.b.club}
                        weight={fight.b.weightKg}
                        side="B"
                      />
                    ) : (
                      <p className="rounded-md border border-dashed px-3 py-2 text-muted-foreground">
                        Pas d’adversaire (nombre impair)
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AppShell>
  )
}

function FighterCard({
  name,
  club,
  weight,
  side
}: {
  name: string
  club: string
  weight: number
  side: 'A' | 'B'
}) {
  return (
    <div
      className={`rounded-md border bg-slate-50/90 px-3 py-2 ${side === 'B' ? 'sm:text-right' : ''}`}
    >
      <p className="font-medium text-judo-navy truncate">{name}</p>
      <p className="text-xs text-muted-foreground truncate">
        {club} · {Number.isInteger(weight) ? weight : weight.toFixed(1).replace('.', ',')} kg
      </p>
    </div>
  )
}
