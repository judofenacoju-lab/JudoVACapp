import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { exportBadgesPdf } from '../pdf/badge-pdf'
import type { Judoka } from '@shared/types/judoka'
import type { BadgeTemplate } from '@shared/types/badge'

export interface PrintBadgesOptions {
  judokas: Judoka[]
  template: BadgeTemplate
  printerName?: string
  copies?: number
  silent?: boolean
  perPage?: 4 | 6 | 8
}

/**
 * Impression via Electron Printer API :
 * génère un PDF temporaire puis webContents.print().
 */
export async function printBadges(options: PrintBadgesOptions): Promise<{ pdfPath: string }> {
  const dir = join(app.getPath('userData'), 'exports')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const pdfPath = join(dir, `print-${Date.now()}.pdf`)
  await exportBadgesPdf({
    outputPath: pdfPath,
    template: options.template,
    judokas: options.judokas,
    perPage: options.perPage ?? 4
  })

  await printPdfFile(pdfPath, {
    printerName: options.printerName,
    copies: options.copies ?? 1,
    silent: options.silent ?? false
  })

  return { pdfPath }
}

export async function listPrinters(): Promise<Electron.PrinterInfo[]> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  })
  try {
    await win.loadURL('about:blank')
    return await win.webContents.getPrintersAsync()
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function printPdfFile(
  pdfPath: string,
  opts: { printerName?: string; copies: number; silent: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { plugins: true }
    })

    const cleanup = (): void => {
      setTimeout(() => {
        if (!win.isDestroyed()) win.destroy()
      }, 1200)
    }

    win
      .loadURL(`file://${pdfPath.replace(/\\/g, '/')}`)
      .then(() => {
        setTimeout(() => {
          win.webContents.print(
            {
              silent: opts.silent,
              printBackground: true,
              copies: opts.copies,
              deviceName: opts.printerName || undefined,
              margins: { marginType: 'none' }
            },
            (success, failureReason) => {
              cleanup()
              if (!success) reject(new Error(failureReason || 'Échec impression'))
              else resolve()
            }
          )
        }, 700)
      })
      .catch((err) => {
        cleanup()
        reject(err)
      })
  })
}
