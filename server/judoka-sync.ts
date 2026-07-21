import type { Judoka } from '@shared/types/judoka'
import { getContainer } from './container'

/** Si le client envoie une photo en base64, l'enregistre côté serveur. */
export async function materializeSyncedPhoto(
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const base64 = typeof data.photoBase64 === 'string' ? data.photoBase64 : null
  if (!base64) {
    const { photoBase64: _b, photoExt: _e, ...rest } = data
    return rest
  }
  const { PhotoStorage } = await import('@core/infrastructure/storage/photo-storage')
  const ext =
    typeof data.photoExt === 'string' && data.photoExt.startsWith('.')
      ? data.photoExt
      : '.jpg'
  const path = new PhotoStorage().saveBuffer(Buffer.from(base64, 'base64'), `sync${ext}`)
  const { photoBase64: _b, photoExt: _e, ...rest } = data
  return { ...rest, photoPath: path }
}

/** Normalise le payload client pour passer la validation Zod côté serveur. */
export function sanitizeSyncedJudokaPayload(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data }
  delete out.force
  delete out.queued
  delete out.synced
  delete out.local
  delete out.queueId
  delete out.queueSize

  if (typeof out.email === 'string' && out.email.trim() && !out.email.includes('@')) {
    out.email = ''
  }
  if (out.weightKg === 0 || out.weightKg === '') out.weightKg = null
  if (out.heightCm === 0 || out.heightCm === '') out.heightCm = null
  if (out.affiliationYear === 0 || out.affiliationYear === '') out.affiliationYear = null

  if (typeof out.createdBy !== 'string' || !out.createdBy.trim()) {
    out.createdBy = 'client'
  }
  if (typeof out.createdWorkstation !== 'string' || !out.createdWorkstation.trim()) {
    out.createdWorkstation = 'poste'
  }
  return out
}

/**
 * Create-or-update judoka depuis un client (Socket ou HTTP).
 */
export async function upsertSyncedJudoka(
  rawData: Record<string, unknown>,
  force = false
): Promise<{ judoka: Judoka }> {
  const container = getContainer()
  if (!container.createJudoka || !container.updateJudoka || !container.judokaRepo) {
    throw new Error('Stockage local indisponible')
  }

  const data = sanitizeSyncedJudokaPayload(await materializeSyncedPhoto({ ...rawData }))
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : null
  const existing = id ? await container.judokaRepo.findById(id) : null

  if (existing) {
    return container.updateJudoka.execute(existing.id, data, { force })
  }
  return container.createJudoka.execute(data, { force })
}
