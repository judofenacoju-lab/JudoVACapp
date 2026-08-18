import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageUp, Timer } from 'lucide-react'
import type { ChronoCombat, ChronoConnectResponse } from '@shared/types/chrono'
import { teamWinMethodLabel, type TeamWinMethod } from '@shared/types/combats'
import { combatPhaseLabel } from '@shared/utils/combat-phase'
import {
  chronoBaseUrl,
  connectChrono,
  parseHostPort,
  refreshChrono,
  setChronoStatus,
  setChronoSubstitute,
  setChronoWinner
} from './lib/api'
import defaultLogo from './assets/judovac-logo.png'

const DEFAULT_PORT = 3847
const DEFAULT_SECONDS = 4 * 60
const LOGO_STORAGE_KEY = 'jvac-chrono-logo'

function formatClock(total: number): string {
  const s = Math.max(0, Math.floor(total))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function fighterName(c: ChronoCombat, side: 'top' | 'bottom'): string {
  const f = side === 'top' ? c.top : c.bottom
  return f?.name ?? (c.bye ? 'Bye' : '—')
}

function fighterMeta(c: ChronoCombat, side: 'top' | 'bottom'): string {
  const f = side === 'top' ? c.top : c.bottom
  if (!f) return ''
  return [f.club, f.age > 0 ? `${f.age} ans` : null].filter(Boolean).join(' · ')
}

function phaseForCombat(c: ChronoCombat | null): string {
  if (!c || c.kind === 'team') return ''
  return combatPhaseLabel(c.phase, 'chrono')
}

function readStoredLogo(): string {
  try {
    const stored = localStorage.getItem(LOGO_STORAGE_KEY)
    return stored?.startsWith('data:image/') ? stored : defaultLogo
  } catch {
    return defaultLogo
  }
}

export function App() {
  const [hostInput, setHostInput] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<ChronoConnectResponse | null>(null)
  const [base, setBase] = useState('')
  const [pwd, setPwd] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(DEFAULT_SECONDS)
  const [running, setRunning] = useState(false)
  const [duration, setDuration] = useState(DEFAULT_SECONDS)
  const [logoSrc, setLogoSrc] = useState(readStoredLogo)
  const [view, setView] = useState<'board' | 'display'>('board')
  const fileRef = useRef<HTMLInputElement>(null)

  const current = useMemo(
    () => session?.combats.find((c) => c.id === currentId) ?? null,
    [session, currentId]
  )

  useEffect(() => {
    if (!session) return
    const next =
      session.combats.find((c) => c.status === 'in_progress') ??
      session.combats.find((c) => c.status === 'ready' && (c.top || c.bottom)) ??
      session.combats.find((c) => c.status !== 'completed') ??
      session.combats[0] ??
      null
    setCurrentId((id) => {
      if (id && session.combats.some((c) => c.id === id)) return id
      return next?.id ?? null
    })
  }, [session])

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => {
      setRemaining((v) => {
        if (v <= 1) {
          setRunning(false)
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [running])

  useEffect(() => {
    if (!base || !pwd) return
    const t = window.setInterval(() => {
      void refreshChrono(base, pwd)
        .then(setSession)
        .catch(() => undefined)
    }, 4000)
    return () => window.clearInterval(t)
  }, [base, pwd])

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl.startsWith('data:image/')) return
      try {
        localStorage.setItem(LOGO_STORAGE_KEY, dataUrl)
      } catch {
        /* quota */
      }
      setLogoSrc(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const { host, port } = parseHostPort(hostInput, DEFAULT_PORT)
      if (!host) throw new Error('Saisissez l’adresse IP du Serveur.')
      if (!password.trim()) throw new Error('Saisissez le mot de passe du tatami.')
      const url = chronoBaseUrl(host, port)
      const data = await connectChrono(url, password.trim())
      setBase(url)
      setPwd(password.trim())
      setSession(data)
      setRemaining(duration)
      setRunning(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion impossible')
    } finally {
      setBusy(false)
    }
  }

  async function startMatch(): Promise<void> {
    if (!session || !current || !base) return
    setBusy(true)
    setError(null)
    try {
      const data = await setChronoStatus(base, pwd, current.id, 'in_progress')
      setSession(data)
      setRunning(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de démarrer')
    } finally {
      setBusy(false)
    }
  }

  async function declareWinner(winnerId: string, winMethod?: TeamWinMethod): Promise<void> {
    if (!session || !current || !base) return
    setBusy(true)
    setError(null)
    try {
      const data = await setChronoWinner(base, pwd, current.id, winnerId, winMethod)
      setSession(data)
      setRunning(false)
      setRemaining(duration)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’enregistrer le vainqueur')
    } finally {
      setBusy(false)
    }
  }

  async function useSubstitute(slot: 'top' | 'bottom'): Promise<void> {
    if (!session || !current || !base) return
    setBusy(true)
    setError(null)
    try {
      const data = await setChronoSubstitute(base, pwd, current.id, slot)
      setSession(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de placer le remplaçant')
    } finally {
      setBusy(false)
    }
  }

  function disconnect(): void {
    setSession(null)
    setBase('')
    setPwd('')
    setRunning(false)
    setRemaining(duration)
    setView('board')
  }

  const headerActions = (
    <div className="header-actions">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onLogoFile}
      />
      <button
        className="btn-icon"
        type="button"
        title="Charger un logo"
        onClick={() => fileRef.current?.click()}
      >
        <ImageUp size={18} />
        <span className="sr-only">Charger</span>
      </button>
      <button className="btn" type="button" onClick={() => setView('display')}>
        <Timer size={16} />
        Chrono
      </button>
      {session ? (
        <button className="btn btn-outline" type="button" onClick={disconnect}>
          Déconnecter
        </button>
      ) : null}
    </div>
  )

  if (view === 'display') {
    return (
      <ChronoDisplay
        combat={current}
        remaining={remaining}
        running={running}
        logoSrc={logoSrc}
        tatamiName={session?.tatamiName || (session ? `Tatami-${session.tatamiIndex + 1}` : '')}
        onClose={() => setView('board')}
      />
    )
  }

  if (!session) {
    return (
      <div className="page">
        <header className="header">
          <div>
            <h1>JVac-Chrono</h1>
            <p>Chronométrage des combats</p>
          </div>
          {headerActions}
        </header>
        <div className="login">
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault()
              void connect()
            }}
          >
            <h2 style={{ marginTop: 0 }}>Connexion au Serveur</h2>
            {error && <div className="error">{error}</div>}
            <label htmlFor="ip">Adresse IP du Serveur</label>
            <input
              id="ip"
              value={hostInput}
              placeholder="192.168.1.10"
              autoComplete="off"
              onChange={(e) => setHostInput(e.target.value)}
            />
            <label htmlFor="pwd">Mot de passe du tatami</label>
            <input
              id="pwd"
              value={password}
              placeholder="Ex. K7M3PQ"
              autoComplete="off"
              onChange={(e) => setPassword(e.target.value.toUpperCase())}
            />
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Connexion…' : 'Prendre en charge le tatami'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>JVac-Chrono · {session.tatamiName || `Tatami-${session.tatamiIndex + 1}`}</h1>
          <p>
            {session.kind === 'team' ? 'Par équipe · ' : 'Individuel · '}
            {session.combats.length} combat(s) · {base.replace(/^http:\/\//, '')}
          </p>
        </div>
        {headerActions}
      </header>
      <div className="board">
        <section className="card">
          {error && <div className="error">{error}</div>}
          {!current ? (
            <p>Aucun combat avec judoka sur ce tatami.</p>
          ) : (
            <>
              <p style={{ marginTop: 0, color: 'var(--muted)' }}>
                {current.kind === 'team' && current.teamMatchLabel
                  ? `${current.teamMatchLabel} · `
                  : ''}
                {current.label} · {current.poolLabel}
                {phaseForCombat(current) ? ` · ${phaseForCombat(current)}` : ''}
                {current.goldenScore ? ' · Golden Score' : ''}
              </p>
              <div className="fighters">
                <div className={current.kind === 'team' ? 'fighter team-a' : 'fighter white'}>
                  <div className="side-tag">{current.kind === 'team' ? 'Équipe A · Bleu' : 'Blanc'}</div>
                  <div className="name">{fighterName(current, 'top')}</div>
                  <div className="meta">{fighterMeta(current, 'top')}</div>
                  {current.topSubstitute && (
                    <div className="meta">Rempl. {current.topSubstitute.name}</div>
                  )}
                </div>
                <div className="vs">VS</div>
                <div className={current.kind === 'team' ? 'fighter team-b' : 'fighter blue'}>
                  <div className="side-tag">{current.kind === 'team' ? 'Équipe B · Rouge' : 'Bleu'}</div>
                  <div className="name">{fighterName(current, 'bottom')}</div>
                  <div className="meta">{fighterMeta(current, 'bottom')}</div>
                  {current.bottomSubstitute && (
                    <div className="meta">Rempl. {current.bottomSubstitute.name}</div>
                  )}
                </div>
              </div>
              <div className="chrono">{formatClock(remaining)}</div>
              <div className="actions">
                <select
                  style={{ width: 'auto', marginBottom: 0 }}
                  value={duration}
                  disabled={running}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setDuration(v)
                    if (!running) setRemaining(v)
                  }}
                >
                  <option value={120}>2 min</option>
                  <option value={180}>3 min</option>
                  <option value={240}>4 min</option>
                  <option value={300}>5 min</option>
                </select>
                {current.status !== 'completed' && (current.top || current.bottom) && !running && (
                  <button className="btn" type="button" disabled={busy} onClick={() => void startMatch()}>
                    Démarrer
                  </button>
                )}
                {running && (
                  <button className="btn btn-navy" type="button" onClick={() => setRunning(false)}>
                    Pause
                  </button>
                )}
                {!running && remaining !== duration && current.status !== 'completed' && (
                  <button className="btn btn-navy" type="button" onClick={() => setRunning(true)}>
                    Reprendre
                  </button>
                )}
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => {
                    setRunning(false)
                    setRemaining(duration)
                  }}
                >
                  Reset
                </button>
              </div>
              {current.status !== 'completed' && (current.topSubstitute || current.bottomSubstitute) && (
                <div className="actions" style={{ marginTop: 14 }}>
                  {current.topSubstitute && (
                    <button
                      className="btn btn-outline"
                      type="button"
                      disabled={busy}
                      onClick={() => void useSubstitute('top')}
                    >
                      Remplaçant {current.kind === 'team' ? 'bleu' : 'blanc'}
                    </button>
                  )}
                  {current.bottomSubstitute && (
                    <button
                      className="btn btn-outline"
                      type="button"
                      disabled={busy}
                      onClick={() => void useSubstitute('bottom')}
                    >
                      Remplaçant {current.kind === 'team' ? 'rouge' : 'bleu'}
                    </button>
                  )}
                </div>
              )}
              {current.status !== 'completed' && (current.top || current.bottom) && (
                current.kind === 'team' ? (
                  <TeamChronoResultButtons
                    combat={current}
                    busy={busy}
                    onResult={(winnerId, method) => void declareWinner(winnerId, method)}
                  />
                ) : (
                <div className="actions" style={{ marginTop: 14 }}>
                  {current.top && (
                    <button
                      className="btn btn-navy"
                      type="button"
                      disabled={busy}
                      onClick={() => void declareWinner(current.top!.id)}
                    >
                      {current.bottom ? 'Vainqueur blanc' : 'Confirmer la victoire'}
                    </button>
                  )}
                  {current.bottom && (
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => void declareWinner(current.bottom!.id)}
                    >
                      {current.top ? 'Vainqueur bleu' : 'Confirmer la victoire'}
                    </button>
                  )}
                </div>
                )
              )}
              {current.status === 'completed' && (
                <p style={{ textAlign: 'center', fontWeight: 600 }}>
                  Combat terminé
                  {current.kind === 'team' && current.winMethod
                    ? ` · ${teamWinMethodLabel(current.winMethod)}`
                    : ''}
                </p>
              )}
            </>
          )}
        </section>
        <aside className="card">
          <h3 style={{ marginTop: 0 }}>File du tatami</h3>
          <ul className="queue">
            {session.combats.map((c) => (
              <li
                key={c.id}
                className={`${c.id === current?.id ? 'active' : ''} ${c.status === 'completed' ? 'done' : ''}`}
              >
                <button
                  type="button"
                  className="btn-outline"
                  style={{ width: '100%', textAlign: 'left', padding: 0, border: 0, background: 'transparent' }}
                  onClick={() => {
                    setCurrentId(c.id)
                    setRunning(false)
                    setRemaining(duration)
                  }}
                >
                  <strong>{c.label}</strong>{' '}
                  <span className="badge">
                    {c.kind === 'team' ? (c.goldenScore ? 'GS · ' : 'Équipe · ') : ''}
                    {c.status === 'completed'
                      ? 'Terminé'
                      : phaseForCombat(c) || `Tour ${c.round + 1}`}
                  </span>
                  {c.teamMatchLabel && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: 2 }}>
                      {c.teamMatchLabel}
                    </div>
                  )}
                  <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
                    {fighterName(c, 'top')} vs {fighterName(c, 'bottom')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}

function ChronoDisplay({
  combat,
  remaining,
  running,
  logoSrc,
  tatamiName,
  onClose
}: {
  combat: ChronoCombat | null
  remaining: number
  running: boolean
  logoSrc: string
  tatamiName: string
  onClose: () => void
}) {
  const phase = phaseForCombat(combat)
  const showPhase = Boolean(combat && phase)

  return (
    <div className="display-page">
      <button className="display-back" type="button" onClick={onClose}>
        Retour
      </button>
      <div className="display-brand">
        <div className="logo-plate">
          <img src={logoSrc} alt="Logo" />
        </div>
        {showPhase ? <div className="phase-banner">{phase}</div> : null}
      </div>
      {combat ? (
        <>
          <p className="display-meta">
            {tatamiName ? `${tatamiName} · ` : ''}
            {combat.kind === 'team' && combat.teamMatchLabel ? `${combat.teamMatchLabel} · ` : ''}
            {combat.label} · {combat.poolLabel}
            {running ? ' · En cours' : ''}
          </p>
          <div className="display-clock">{formatClock(remaining)}</div>
          <div className="display-fighters">
            <div className={combat.kind === 'team' ? 'fighter team-a' : 'fighter white'}>
              <div className="side-tag">{combat.kind === 'team' ? 'Équipe A · Bleu' : 'Blanc'}</div>
              <div className="name">{fighterName(combat, 'top')}</div>
              <div className="meta">{fighterMeta(combat, 'top')}</div>
            </div>
            <div className={combat.kind === 'team' ? 'fighter team-b' : 'fighter blue'}>
              <div className="side-tag">{combat.kind === 'team' ? 'Équipe B · Rouge' : 'Bleu'}</div>
              <div className="name">{fighterName(combat, 'bottom')}</div>
              <div className="meta">{fighterMeta(combat, 'bottom')}</div>
            </div>
          </div>
        </>
      ) : (
        <p className="display-wait">En attente de combat</p>
      )}
    </div>
  )
}

function TeamChronoResultButtons({
  combat,
  busy,
  onResult
}: {
  combat: ChronoCombat
  busy: boolean
  onResult: (winnerId: string, method: TeamWinMethod) => void
}) {
  const methods: Array<{ method: TeamWinMethod; label: string }> = [
    { method: 'ippon', label: 'Ippon' },
    { method: 'waza_ari', label: 'Waza-ari' },
    { method: 'hantei', label: 'Victoire' }
  ]
  return (
    <div className="team-results">
      {combat.top && combat.bottom && (
        <>
          <div className="team-result-row">
            <span>Bleu gagne</span>
            {methods.map((m) => (
              <button
                key={`a-${m.method}`}
                className="btn btn-navy"
                type="button"
                disabled={busy}
                onClick={() => onResult(combat.top!.id, m.method)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="team-result-row">
            <span>Rouge gagne</span>
            {methods.map((m) => (
              <button
                key={`b-${m.method}`}
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => onResult(combat.bottom!.id, m.method)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button
              className="btn btn-outline"
              type="button"
              disabled={busy}
              onClick={() => onResult('', 'draw')}
            >
              Match nul
            </button>
          </div>
        </>
      )}
      {combat.top && !combat.bottom && (
        <div className="actions">
          <button
            className="btn btn-navy"
            type="button"
            disabled={busy}
            onClick={() => onResult(combat.top!.id, 'fusen')}
          >
            Victoire bleu par absence
          </button>
        </div>
      )}
      {combat.bottom && !combat.top && (
        <div className="actions">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => onResult(combat.bottom!.id, 'fusen')}
          >
            Victoire rouge par absence
          </button>
        </div>
      )}
    </div>
  )
}
