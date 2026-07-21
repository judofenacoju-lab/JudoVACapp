import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SystemLogEntry } from '@shared/types/dashboard'

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * Journal système — fichier JSON local.
 */
export class SystemLogger {
  private readonly filePath: string
  private fileEntries: SystemLogEntry[] = []

  constructor(userDataPath: string) {
    const dir = join(userDataPath, 'logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'system-logs.json')
    this.loadFile()
  }

  async log(
    level: LogLevel,
    action: string,
    message: string,
    meta?: { actor?: string; workstation?: string; meta?: unknown }
  ): Promise<void> {
    const entry: SystemLogEntry = {
      id: randomUUID(),
      level,
      action,
      message,
      actor: meta?.actor,
      workstation: meta?.workstation,
      createdAt: new Date().toISOString()
    }
    this.fileEntries.unshift(entry)
    this.fileEntries = this.fileEntries.slice(0, 500)
    this.persistFile()
    console.log(`[${level}] ${action}: ${message}`)
  }

  async list(limit = 50): Promise<SystemLogEntry[]> {
    return this.fileEntries.slice(0, limit)
  }

  async clear(): Promise<void> {
    this.fileEntries = []
    this.persistFile()
  }

  private loadFile(): void {
    if (!existsSync(this.filePath)) {
      this.fileEntries = []
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as { items?: SystemLogEntry[] }
      this.fileEntries = Array.isArray(raw.items) ? raw.items : []
    } catch {
      this.fileEntries = []
    }
  }

  private persistFile(): void {
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify({ items: this.fileEntries }, null, 2), 'utf-8')
    renameSync(tmp, this.filePath)
  }
}
