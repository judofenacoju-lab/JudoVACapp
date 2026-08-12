import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

function resolvePreloadPath(): string {
  const mjs = join(__dirname, '../preload/index.mjs')
  const js = join(__dirname, '../preload/index.js')
  if (existsSync(mjs)) return mjs
  return js
}

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath, 'icon.icns'),
    join(process.resourcesPath, 'icon.ico'),
    join(process.resourcesPath, 'brand-logo.png'),
    join(__dirname, '../../chrono-app/build/icon.icns'),
    join(__dirname, '../../chrono-app/build/icon.ico'),
    join(__dirname, '../../chrono-app/build/icon.png')
  ]
  return candidates.find((p) => existsSync(p))
}

function createWindow(): BrowserWindow {
  const icon = resolveAppIcon()
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'JVac-Chrono',
    backgroundColor: '#0B1F3A',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
