import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const INSTALL_MARKER = '.judovac-install-marker'

/**
 * Sur une première installation (nouvel ordinateur, userData vide),
 * initialise explicitement une base judokas vide pour le Serveur.
 * Les installations existantes (fichier judokas déjà présent) ne sont pas effacées.
 */
export function ensureFreshInstallOnFirstRun(userDataPath: string): boolean {
  const markerPath = join(userDataPath, INSTALL_MARKER)
  if (existsSync(markerPath)) return false

  const dataDir = join(userDataPath, 'data')
  const judokasPath = join(dataDir, 'judokas.json')

  if (existsSync(judokasPath)) {
    writeFileSync(markerPath, new Date().toISOString(), 'utf-8')
    return false
  }

  mkdirSync(dataDir, { recursive: true })
  writeFileSync(judokasPath, JSON.stringify({ seq: 0, items: [] }, null, 2), 'utf-8')
  writeFileSync(
    join(dataDir, 'user-accounts.json'),
    JSON.stringify({ items: [] }, null, 2),
    'utf-8'
  )

  for (const sub of ['photos', 'queue', 'exports', 'backups'] as const) {
    const dir = join(userDataPath, sub)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      try {
        rmSync(join(dir, name), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }

  writeFileSync(markerPath, new Date().toISOString(), 'utf-8')
  return true
}
