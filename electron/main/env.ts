import { app } from 'electron'
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'fs'
import { join, dirname, resolve } from 'path'

/**
 * Charge un fichier .env simple (KEY=VALUE) dans process.env
 * sans dépendance externe — adapté offline / desktop.
 */
export function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf-8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

/**
 * Chemins .env :
 * 1) userData/.env (production — editable)
 * 2) resources/.env (embarqué éventuellement)
 * 3) cwd/.env (dev)
 * 4) racine projet (dev via electron.vite)
 *
 * Si aucun .env utilisateur : copie .env.example → userData/.env
 */
export function loadAppEnv(): void {
  // app peut ne pas être prêt si appelé trop tôt — try/catch
  let userData = ''
  let resourcesPath = ''
  try {
    userData = app.getPath('userData')
    resourcesPath = process.resourcesPath
  } catch {
    userData = resolve(process.cwd(), 'data')
    resourcesPath = resolve(process.cwd())
  }

  const userEnv = join(userData, '.env')
  const exampleFromResources = join(resourcesPath, '.env.example')
  const exampleFromCwd = resolve(process.cwd(), '.env.example')

  if (!existsSync(userEnv)) {
    const example = existsSync(exampleFromResources)
      ? exampleFromResources
      : existsSync(exampleFromCwd)
        ? exampleFromCwd
        : null
    if (example) {
      try {
        if (!existsSync(userData)) mkdirSync(userData, { recursive: true })
        copyFileSync(example, userEnv)
      } catch {
        /* ignore */
      }
    }
  }

  const candidates = [
    userEnv,
    join(resourcesPath, '.env'),
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../.env')
  ]

  for (const p of candidates) {
    if (existsSync(p)) {
      loadEnvFile(p)
      return
    }
  }
}

export function getUserEnvPath(): string {
  try {
    return join(app.getPath('userData'), '.env')
  } catch {
    return resolve(process.cwd(), '.env')
  }
}

void dirname
