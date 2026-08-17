import { Router } from 'express'
import { SettingsStore } from '@core/infrastructure/settings/settings-store'
import {
  applyCombatSubstitute,
  applyCombatWinner,
  combatSessionKind,
  hasAtLeastOneJudoka,
  type CombatSession,
  type CombatStatus
} from '@shared/types/combats'
import { toChronoCombat, type ChronoConnectResponse } from '@shared/types/chrono'
import { normalizeTeamWeightClasses, resolveTeamMatches } from '@shared/utils/team-tirage'
import { normalizeTeams } from '@shared/types/teams'
import { getContainer } from '../container'
import { SocketEvents } from '@shared/constants/socket-events'

function normalizePassword(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
}

async function loadSession(): Promise<CombatSession | null> {
  const settings = await new SettingsStore().get()
  return settings.combatSession ?? null
}

async function saveSession(session: CombatSession): Promise<CombatSession> {
  const settings = await new SettingsStore().set({ combatSession: session })
  try {
    const { getIo } = await import('../bootstrap')
    getIo()?.emit(SocketEvents.SETTINGS_CHANGED, settings)
  } catch {
    /* ignore */
  }
  return settings.combatSession ?? session
}

function resolveTatami(session: CombatSession, password: string) {
  const p = normalizePassword(password)
  if (!p) return null
  const index = session.tatamis.findIndex((t) => normalizePassword(t.password) === p)
  if (index < 0) return null
  return { tatami: session.tatamis[index]!, index }
}

function combatsForTatami(session: CombatSession, tatamiId: string) {
  return session.combats
    .filter((c) => c.tatamiId === tatamiId && hasAtLeastOneJudoka(c))
    .sort((a, b) => a.orderOnTatami - b.orderOnTatami || a.round - b.round || a.matchIndex - b.matchIndex)
    .map(toChronoCombat)
}

function payload(session: CombatSession, tatamiId: string, index: number): ChronoConnectResponse {
  const tatami = session.tatamis[index]!
  return {
    ok: true,
    tatamiId,
    tatamiName: tatami.name,
    tatamiIndex: index,
    sessionId: session.id,
    confirmedAt: session.confirmedAt,
    kind: combatSessionKind(session),
    combats: combatsForTatami(session, tatamiId)
  }
}

/**
 * API LAN pour JVac-Chrono — authentification par mot de passe de tatami.
 */
export function createChronoRouter(): Router {
  const router = Router()

  router.post('/connect', async (req, res) => {
    const session = await loadSession()
    if (!session?.confirmedAt) {
      res.status(409).json({
        ok: false,
        error: 'Aucun combat confirmé sur le Serveur. Confirmez d’abord la session Combats.'
      })
      return
    }
    const found = resolveTatami(session, req.body?.password)
    if (!found) {
      res.status(401).json({ ok: false, error: 'Mot de passe tatami incorrect.' })
      return
    }
    res.json(payload(session, found.tatami.id, found.index))
  })

  router.post('/combats', async (req, res) => {
    const session = await loadSession()
    if (!session?.confirmedAt) {
      res.status(409).json({ ok: false, error: 'Session Combats non confirmée.' })
      return
    }
    const found = resolveTatami(session, req.body?.password)
    if (!found) {
      res.status(401).json({ ok: false, error: 'Mot de passe tatami incorrect.' })
      return
    }
    res.json(payload(session, found.tatami.id, found.index))
  })

  router.post('/combat/status', async (req, res) => {
    const session = await loadSession()
    if (!session?.confirmedAt) {
      res.status(409).json({ ok: false, error: 'Session Combats non confirmée.' })
      return
    }
    const found = resolveTatami(session, req.body?.password)
    if (!found) {
      res.status(401).json({ ok: false, error: 'Mot de passe tatami incorrect.' })
      return
    }
    const combatId = String(req.body?.combatId ?? '')
    const status = String(req.body?.status ?? '') as CombatStatus
    if (!['ready', 'in_progress', 'completed', 'pending'].includes(status)) {
      res.status(400).json({ ok: false, error: 'Statut invalide.' })
      return
    }
    const combat = session.combats.find((c) => c.id === combatId && c.tatamiId === found.tatami.id)
    if (!combat) {
      res.status(404).json({ ok: false, error: 'Combat introuvable sur ce tatami.' })
      return
    }
    const now = new Date().toISOString()
    const next: CombatSession = {
      ...session,
      combats: session.combats.map((c) =>
        c.id === combatId ? { ...c, status, updatedAt: now } : c
      ),
      updatedAt: now
    }
    const saved = await saveSession(next)
    res.json(payload(saved, found.tatami.id, found.index))
  })

  router.post('/combat/winner', async (req, res) => {
    const session = await loadSession()
    if (!session?.confirmedAt) {
      res.status(409).json({ ok: false, error: 'Session Combats non confirmée.' })
      return
    }
    const found = resolveTatami(session, req.body?.password)
    if (!found) {
      res.status(401).json({ ok: false, error: 'Mot de passe tatami incorrect.' })
      return
    }
    const combatId = String(req.body?.combatId ?? '')
    const winnerId = String(req.body?.winnerId ?? '')
    const combat = session.combats.find((c) => c.id === combatId && c.tatamiId === found.tatami.id)
    if (!combat) {
      res.status(404).json({ ok: false, error: 'Combat introuvable sur ce tatami.' })
      return
    }
    let next = applyCombatWinner(session, combatId, winnerId)
    if (combatSessionKind(next) === 'team') {
      const settings = await new SettingsStore().get()
      const listed = getContainer().listJudoka
        ? await getContainer().listJudoka.execute(1_000_000, 0)
        : []
      next = resolveTeamMatches(next, {
        teams: normalizeTeams(settings.teams ?? []),
        judokas: listed,
        weightClasses: normalizeTeamWeightClasses(settings.teamWeightClasses ?? [])
      })
    }
    const saved = await saveSession(next)
    res.json(payload(saved, found.tatami.id, found.index))
  })

  router.post('/combat/substitute', async (req, res) => {
    const session = await loadSession()
    if (!session?.confirmedAt) {
      res.status(409).json({ ok: false, error: 'Session Combats non confirmée.' })
      return
    }
    const found = resolveTatami(session, req.body?.password)
    if (!found) {
      res.status(401).json({ ok: false, error: 'Mot de passe tatami incorrect.' })
      return
    }
    const combatId = String(req.body?.combatId ?? '')
    const slot = req.body?.slot === 'bottom' ? 'bottom' : req.body?.slot === 'top' ? 'top' : null
    if (!slot) {
      res.status(400).json({ ok: false, error: 'Côté invalide.' })
      return
    }
    const combat = session.combats.find((c) => c.id === combatId && c.tatamiId === found.tatami.id)
    if (!combat) {
      res.status(404).json({ ok: false, error: 'Combat introuvable sur ce tatami.' })
      return
    }
    const next = applyCombatSubstitute(session, combatId, slot)
    const saved = await saveSession(next)
    res.json(payload(saved, found.tatami.id, found.index))
  })

  return router
}
