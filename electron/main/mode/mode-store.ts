import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ModeConfig } from '@shared/types/mode'

/**
 * Persistance locale du mode choisi (Serveur / Client).
 * Fichier JSON dans userData — survit aux redémarrages.
 */
export class ModeStore {
  private config: ModeConfig | null = null
  private readonly filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), 'mode.json')
  }

  load(): ModeConfig | null {
    if (!existsSync(this.filePath)) {
      this.config = null
      return null
    }
    try {
      this.config = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ModeConfig
      return this.config
    } catch {
      this.config = null
      return null
    }
  }

  get(): ModeConfig | null {
    return this.config
  }

  set(config: ModeConfig): void {
    this.config = config
    writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8')
  }

  clear(): void {
    this.config = null
    if (existsSync(this.filePath)) unlinkSync(this.filePath)
  }
}
