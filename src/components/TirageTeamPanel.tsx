import { useEffect, useState } from 'react'
import { Dices, RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { normalizeTeams, teamDisplayName, type Team } from '@shared/types/teams'
import {
  generateTeamTirage,
  mergeTeamTirageIntoCombatSession,
  teamMatchScore,
  type TeamTirageResult
} from '@shared/utils/team-tirage'
import { createDefaultCategoryAgeRanges } from '@shared/types/settings'
import { listTatamisWithoutCombats, isCombatSchedulableOnTatami } from '@shared/types/combats'

interface Props {
  tatamiCount: number
  onTatamiCount: (n: number) => void
}

/**
 * Tirage par club : rencontre d’équipes, combats selon les catégories des judokas.
 */
export function TirageTeamPanel({ tatamiCount, onTatamiCount }: Props) {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<TeamTirageResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await window.judovac.getSettings()
      if (cancelled || !res.ok) return
      setTeams(normalizeTeams(res.data.teams))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function run(): Promise<void> {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const settingsRes = await window.judovac.getSettings()
      if (!settingsRes.ok) {
        setError(settingsRes.error)
        return
      }
      const registered = normalizeTeams(settingsRes.data.teams)
      setTeams(registered)
      if (registered.length < 2) {
        setResult(null)
        setError(
          'Enregistrez au moins deux équipes (menu Nouvelle équipe) avant le tirage par équipe.'
        )
        return
      }
      const listed = await window.judovac.listJudokas({ limit: 5000, offset: 0 })
      if (!listed.ok) {
        setError(listed.error)
        return
      }
      const generated = generateTeamTirage(
        registered,
        listed.data.items,
        settingsRes.data.categories?.length
          ? settingsRes.data.categories
          : createDefaultCategoryAgeRanges()
      )
      if (generated.boutCount === 0) {
        setResult(generated)
        setError(
          'Aucun combat généré. Vérifiez que les équipes ont des judokas dans des catégories comparables.'
        )
        return
      }
      setResult(generated)
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

  const matches = result?.session.teamMatches?.filter((m) => m.round === 0) ?? []

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white/75 p-5 space-y-4 max-w-3xl">
        <p className="text-sm text-muted-foreground">
          {teams.length} équipe(s) enregistrée(s). Le tirage apparie les clubs ; chaque rencontre
          produit un combat par catégorie (et sexe) des judokas retenus.
        </p>
        {teams.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {teams.map((t) => (
              <li
                key={t.id}
                className="rounded-full border bg-slate-50 px-3 py-1 text-xs text-judo-navy"
              >
                {teamDisplayName(t)} · {t.judokaIds.length}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="accent" size="lg" disabled={loading} onClick={() => void run()}>
            {result ? <RefreshCw className="h-4 w-4" /> : <Dices className="h-4 w-4" />}
            {loading ? 'Tirage…' : result ? 'Relancer le tirage' : 'Lancer le tirage par équipe'}
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
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {result && result.boutCount > 0 && (
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

      {matches.map((m) => {
        const bouts =
          result?.session.combats.filter((c) => c.teamMatchId === m.id && (c.top || c.bottom)) ??
          []
        const score = result ? teamMatchScore(result.session, m.id) : { home: 0, away: 0 }
        return (
          <section key={m.id} className="rounded-xl border bg-white/80 overflow-hidden max-w-3xl">
            <header className="border-b bg-judo-navy/95 px-4 py-3 text-white">
              <h3 className="font-display text-base font-semibold">
                {m.label} · {m.homeClub} vs {m.awayClub}
              </h3>
              <p className="text-xs text-white/70">
                Par équipe · {bouts.length} combat(s)
                {score.home + score.away > 0 ? ` · score ${score.home}–${score.away}` : ''}
              </p>
            </header>
            <ul className="divide-y">
              {bouts.map((c) => (
                <li key={c.id} className="px-4 py-2.5 text-sm">
                  <p className="text-xs text-muted-foreground">{c.poolLabel}</p>
                  <p className="font-medium text-judo-navy">
                    {c.top?.name ?? 'Bye'} vs {c.bottom?.name ?? 'Bye'}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
