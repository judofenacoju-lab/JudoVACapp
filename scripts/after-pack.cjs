/**
 * Applique l'icône ICO sur JudoVACapp.exe après le packaging Windows
 * (nécessaire quand signAndEditExecutable est false).
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico')

  if (!fs.existsSync(exePath) || !fs.existsSync(icoPath)) {
    console.warn('[afterPack] exe ou icon.ico introuvable — icône non appliquée')
    return
  }

  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || '',
      'electron-builder',
      'Cache',
      'winCodeSign',
      '835022923',
      'rcedit-x64.exe'
    ),
    path.join(
      context.packager.projectDir,
      'node_modules',
      'rcedit',
      'bin',
      'rcedit.exe'
    )
  ]

  const rcedit = candidates.find((p) => p && fs.existsSync(p))
  if (!rcedit) {
    console.warn('[afterPack] rcedit introuvable — icône non appliquée')
    return
  }

  execFileSync(rcedit, [exePath, '--set-icon', icoPath], { stdio: 'inherit' })
  console.log(`[afterPack] Icône appliquée: ${exePath}`)
}
