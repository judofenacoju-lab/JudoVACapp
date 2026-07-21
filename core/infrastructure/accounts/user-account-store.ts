import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UserAccount } from '@shared/types/user-account'

interface StoreFile {
  items: UserAccount[]
}

/**
 * Comptes Client gérés exclusivement par le Serveur.
 * L'identifiant (username) permet la reconnexion et la reprise des judokas.
 */
export class UserAccountStore {
  private readonly filePath: string
  private items: UserAccount[] = []

  constructor(userDataPath: string) {
    const dir = join(userDataPath, 'data')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'user-accounts.json')
    this.load()
  }

  list(): UserAccount[] {
    return [...this.items].sort((a, b) => a.username.localeCompare(b.username, 'fr'))
  }

  findByUsername(username: string): UserAccount | null {
    const key = username.trim().toLowerCase()
    return this.items.find((u) => u.username.toLowerCase() === key) ?? null
  }

  create(username: string, displayName?: string): UserAccount {
    const trimmed = username.trim()
    if (!trimmed) throw new Error('Identifiant utilisateur requis')
    if (trimmed.toLowerCase() === 'serveur') {
      throw new Error('L’identifiant « Serveur » est réservé')
    }
    if (this.findByUsername(trimmed)) {
      throw new Error(`L’identifiant « ${trimmed} » existe déjà`)
    }
    const account: UserAccount = {
      id: randomUUID(),
      username: trimmed,
      displayName: displayName?.trim() || undefined,
      active: true,
      createdAt: new Date().toISOString()
    }
    this.items.push(account)
    this.persist()
    return account
  }

  deleteByUsername(username: string): boolean {
    const key = username.trim().toLowerCase()
    const before = this.items.length
    this.items = this.items.filter((u) => u.username.toLowerCase() !== key)
    if (this.items.length === before) return false
    this.persist()
    return true
  }

  replaceAll(accounts: UserAccount[]): void {
    this.items = [...accounts]
    this.persist()
  }

  /** Ajoute les comptes absents (par username). */
  mergeAll(incoming: UserAccount[]): { added: number } {
    let added = 0
    for (const acc of incoming) {
      if (!acc.username?.trim()) continue
      if (this.findByUsername(acc.username)) continue
      this.items.push(acc)
      added++
    }
    if (added > 0) this.persist()
    return { added }
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.items = []
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<StoreFile>
      this.items = Array.isArray(raw.items) ? raw.items : []
    } catch {
      this.items = []
    }
  }

  private persist(): void {
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2), 'utf-8')
    renameSync(tmp, this.filePath)
  }
}
