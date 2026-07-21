import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { ModeStore } from './mode/mode-store'
import { loadAppEnv } from './env'
import { ensureFreshInstallOnFirstRun } from '@core/infrastructure/bootstrap/fresh-install'

/**
 * Point d'entrée Electron (processus principal).
 * Orchestre le mode Serveur/Client, l'IPC et le démarrage différé du backend.
 */
let mainWindow: BrowserWindow | null = null
const modeStore = new ModeStore()
let isShuttingDown = false

app.whenReady().then(async () => {
  loadAppEnv()
  ensureDataDirs()

  // Toujours démarrer sur l'écran de choix Serveur / Client
  modeStore.clear()

  registerIpcHandlers({
    modeStore,
    getMainWindow: () => mainWindow
  })

  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('before-quit', (event) => {
  if (isShuttingDown) return
  event.preventDefault()
  isShuttingDown = true
  void (async () => {
    try {
      const { stopServerRuntime } = await import('./runtime/server-runtime')
      const { disconnectClientRuntime } = await import('./runtime/client-runtime')
      await stopServerRuntime()
      await disconnectClientRuntime()
      modeStore.clear()
    } catch {
      /* ignore */
    } finally {
      app.exit(0)
    }
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function ensureDataDirs(): void {
  const base = app.getPath('userData')
  for (const dir of ['queue', 'photos', 'assets', 'backups', 'logs', 'exports', 'data']) {
    const full = join(base, dir)
    if (!existsSync(full)) mkdirSync(full, { recursive: true })
  }
  ensureFreshInstallOnFirstRun(base)
}

export { modeStore }
