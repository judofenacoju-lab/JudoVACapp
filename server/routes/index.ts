import { Router } from 'express'
import { APP_NAME, APP_VERSION } from '@shared/constants/app'
import { DuplicateError, NotFoundError, ValidationError } from '@core/domain/errors'
import { formatBadgeCategory, formatBadgeJudokaName } from '@shared/utils/judoka'
import type { BadgeVerifyResponse } from '@shared/types/badge-verify'
import { getContainer } from '../container'
import { clientRegistry } from '../client-registry'

export function createApiRouter(): Router {
  const router = Router()

  router.get('/info', (_req, res) => {
    const c = getContainer()
    res.json({
      app: APP_NAME,
      version: APP_VERSION,
      role: 'server',
      dbReady: c.dbReady,
      dbError: c.dbError,
      at: new Date().toISOString()
    })
  })

  router.get('/dashboard', async (_req, res) => {
    const c = getContainer()
    const total = c.getJudokaStats ? await c.getJudokaStats.execute() : { total: 0, male: 0, female: 0 }
    const judokaByUser =
      c.judokaRepo && 'countByUser' in c.judokaRepo
        ? (c.judokaRepo as { countByUser(): Array<{ username: string; count: number }> }).countByUser()
        : []
    res.json({
      totalJudokas: total.total,
      maleJudokas: total.male ?? 0,
      femaleJudokas: total.female ?? 0,
      connectedClients: clientRegistry.size(),
      networkStatus: 'online',
      pendingSyncCount: 0,
      lastSyncAt: null,
      recentLogs: [],
      userActivity: [],
      judokaByUser,
      dbReady: c.dbReady
    })
  })

  router.get('/judokas', async (req, res) => {
    const c = getContainer()
    if (!c.listJudoka) {
      res.status(503).json({ error: 'Stockage local indisponible', detail: c.dbError })
      return
    }
    const limit = Number(req.query.limit ?? 100)
    const offset = Number(req.query.offset ?? 0)
    const items = await c.listJudoka.execute(limit, offset)
    const total = c.getJudokaStats ? (await c.getJudokaStats.execute()).total : items.length
    res.json({ items, total })
  })

  router.get('/judokas/search', async (req, res) => {
    const c = getContainer()
    if (!c.searchJudoka) {
      res.status(503).json({ error: 'Stockage local indisponible', detail: c.dbError })
      return
    }
    const q = String(req.query.q ?? '')
    const items = await c.searchJudoka.execute(q, {
      club: req.query.club ? String(req.query.club) : undefined,
      province: req.query.province ? String(req.query.province) : undefined,
      league: req.query.league ? String(req.query.league) : undefined,
      grade: req.query.grade ? String(req.query.grade) : undefined,
      phone: req.query.phone ? String(req.query.phone) : undefined,
      licenseNumber: req.query.licenseNumber ? String(req.query.licenseNumber) : undefined,
      createdBy: req.query.createdBy ? String(req.query.createdBy) : undefined
    })
    res.json({ items })
  })

  router.get('/judokas/creators', (_req, res) => {
    const c = getContainer()
    if (!c.judokaRepo || !('listCreators' in c.judokaRepo)) {
      res.status(503).json({ error: 'Stockage local indisponible', detail: c.dbError })
      return
    }
    const connected = clientRegistry.list().map((cl) => cl.username)
    const items = (c.judokaRepo as { listCreators(usernames?: string[]): string[] }).listCreators(
      connected
    )
    res.json({ items })
  })

  /** Vérification badge QR — scanner mobile (LAN). */
  router.get('/badges/verify', async (req, res) => {
    const c = getContainer()
    if (!c.jsonRepo) {
      res.status(503).json({ ok: false, error: 'Stockage local indisponible' })
      return
    }

    const id = String(req.query.id ?? '').trim()
    const displayId = String(req.query.displayId ?? '').trim()

    let judoka =
      (id ? await c.jsonRepo.findById(id) : null) ??
      (displayId ? c.jsonRepo.findByDisplayId(displayId) : null)

    if (!judoka) {
      res.status(404).json({ ok: false, error: 'Badge non reconnu sur ce serveur' })
      return
    }

    const weight =
      judoka.weightKg != null ? `${judoka.weightKg} kg` : ''

    const body: BadgeVerifyResponse = {
      ok: true,
      badge: {
        fullName: formatBadgeJudokaName(judoka),
        category: formatBadgeCategory(judoka.category),
        weight,
        sex: judoka.sex,
        displayId: judoka.displayId
      }
    }
    res.json(body)
  })

  router.get('/judokas/:id', async (req, res) => {
    const c = getContainer()
    if (!c.getJudoka) {
      res.status(503).json({ error: 'Stockage local indisponible', detail: c.dbError })
      return
    }
    try {
      const judoka = await c.getJudoka.execute(req.params.id)
      res.json({ judoka })
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ code: err.code, error: err.message })
        return
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/judokas', async (req, res) => {
    const c = getContainer()
    if (!c.createJudoka) {
      res.status(503).json({ error: 'Stockage local indisponible', detail: c.dbError })
      return
    }
    try {
      const force = Boolean(req.body?.force)
      const result = await c.createJudoka.execute(req.body, { force })
      res.status(201).json(result)
    } catch (err) {
      respondJudokaError(res, err)
    }
  })

  /** Upsert dédié sync client → serveur (create-or-update + photo base64). */
  router.post('/judokas/sync', async (req, res) => {
    try {
      const { upsertSyncedJudoka } = await import('../judoka-sync')
      const force = Boolean(req.body?.force)
      const raw =
        req.body?.data && typeof req.body.data === 'object'
          ? (req.body.data as Record<string, unknown>)
          : ((req.body ?? {}) as Record<string, unknown>)
      const result = await upsertSyncedJudoka(raw, force)
      res.status(200).json({ ok: true, ...result })
    } catch (err) {
      respondJudokaError(res, err)
    }
  })

  router.put('/judokas/:id', async (req, res) => {
    const c = getContainer()
    if (!c.updateJudoka) {
      res.status(503).json({ error: 'Stockage local indisponible', detail: c.dbError })
      return
    }
    try {
      const force = Boolean(req.body?.force)
      const result = await c.updateJudoka.execute(req.params.id, req.body, { force })
      res.json(result)
    } catch (err) {
      respondJudokaError(res, err)
    }
  })

  router.delete('/judokas/:id', async (req, res) => {
    const c = getContainer()
    if (!c.deleteJudoka) {
      res.status(503).json({ error: 'Stockage local indisponible', detail: c.dbError })
      return
    }
    try {
      await c.deleteJudoka.execute(req.params.id, req.body?.actor)
      res.status(204).send()
    } catch (err) {
      respondJudokaError(res, err)
    }
  })

  router.get('/logs', async (req, res) => {
    const c = getContainer()
    const limit = Number(req.query.limit ?? 50)
    res.json({ items: await c.logger.list(limit) })
  })

  return router
}

function respondJudokaError(res: import('express').Response, err: unknown): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ code: err.code, error: err.message, details: err.details })
    return
  }
  if (err instanceof DuplicateError) {
    res.status(409).json({ code: err.code, error: err.message, details: err.details })
    return
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ code: err.code, error: err.message })
    return
  }
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
}
