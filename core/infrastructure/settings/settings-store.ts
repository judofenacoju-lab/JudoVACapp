import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'
import type { AppSettings } from '@shared/types/settings'
import { createDefaultSettings } from '@shared/types/settings'

function defaultBasePath(): string {
  try {
    return app.getPath('userData')
  } catch {
    return resolve(process.cwd(), '.judovac-data')
  }
}

/**
 * Store paramètres — JSON local dans userData/assets/settings.json.
 */
export class SettingsStore {
  private readonly filePath: string
  private cache: AppSettings

  constructor(basePath?: string) {
    const dir = join(basePath ?? defaultBasePath(), 'assets')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'settings.json')
    this.cache = this.loadFromFile()
  }

  async get(): Promise<AppSettings> {
    return this.cache
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get()
    const next: AppSettings = {
      ...current,
      ...patch,
      event: { ...current.event, ...(patch.event ?? {}) },
      print: { ...current.print, ...(patch.print ?? {}) },
      ui: { ...current.ui, ...(patch.ui ?? {}) },
      network: { ...current.network, ...(patch.network ?? {}) },
      updatedAt: new Date().toISOString()
    }

    this.cache = next
    this.writeFile(next)
    return next
  }

  private loadFromFile(): AppSettings {
    if (!existsSync(this.filePath)) {
      const def = createDefaultSettings()
      this.writeFile(def)
      return def
    }
    try {
      return { ...createDefaultSettings(), ...JSON.parse(readFileSync(this.filePath, 'utf-8')) }
    } catch {
      return createDefaultSettings()
    }
  }

  private writeFile(settings: AppSettings): void {
    writeFileSync(this.filePath, JSON.stringify(settings, null, 2), 'utf-8')
  }
}
