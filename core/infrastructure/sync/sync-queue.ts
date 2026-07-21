import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export type QueueOperation = 'upsert' | 'delete'

export interface QueueItem {
  id: string
  operation: QueueOperation
  payload: unknown
  force?: boolean
  createdAt: string
  attempts: number
  lastError?: string
}

/**
 * File d'attente persistante client (JSON atomique).
 * Garantit zéro perte de données hors-ligne.
 */
export class SyncQueue {
  private readonly dir: string
  private readonly filePath: string
  private items: QueueItem[] = []

  constructor(userDataPath: string) {
    this.dir = join(userDataPath, 'queue')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    this.filePath = join(this.dir, 'sync-queue.json')
    this.load()
  }

  size(): number {
    return this.items.length
  }

  /** Recharge depuis le disque (mémoire à jour). */
  reload(): void {
    this.load()
  }

  /**
   * Vide toute la file locale (tous utilisateurs / tous enregistrements en attente
   * sur cet ordinateur) et nettoie le dossier queue.
   */
  clearAll(): number {
    const deleted = this.items.length
    this.items = []
    this.persist()
    try {
      for (const name of readdirSync(this.dir)) {
        if (name === 'sync-queue.json') continue
        try {
          unlinkSync(join(this.dir, name))
        } catch {
          /* ignore fichiers verrouillés */
        }
      }
    } catch {
      /* dossier inaccessible */
    }
    return deleted
  }

  /** Marque tous les éléments pour forcer l’upsert côté serveur. */
  markAllForce(): void {
    let changed = false
    for (const item of this.items) {
      if (!item.force) {
        item.force = true
        changed = true
      }
    }
    if (changed) this.persist()
  }

  list(): QueueItem[] {
    return [...this.items]
  }

  enqueue(operation: QueueOperation, payload: unknown, force = false): QueueItem {
    const item: QueueItem = {
      id: randomUUID(),
      operation,
      payload,
      force,
      createdAt: new Date().toISOString(),
      attempts: 0
    }
    this.items.push(item)
    this.persist()
    return item
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id)
    this.persist()
  }

  markAttempt(id: string, error?: string): void {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    item.attempts += 1
    item.lastError = error
    this.persist()
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.items = []
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as { items?: QueueItem[] }
      this.items = Array.isArray(raw.items) ? raw.items : []
    } catch {
      this.items = []
    }
  }

  /** Écriture atomique : tmp + rename */
  private persist(): void {
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2), 'utf-8')
    renameSync(tmp, this.filePath)
  }
}
