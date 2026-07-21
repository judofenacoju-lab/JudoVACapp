import { ipcMain, app } from 'electron'
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IpcChannels } from '@shared/constants/ipc-channels'
import { APP_VERSION, DEFAULT_SERVER_PORT } from '@shared/constants/app'
import type { ModeConfig, AppRuntimeInfo } from '@shared/types/mode'
import type { Judoka } from '@shared/types/judoka'
import type { UserAccount } from '@shared/types/user-account'
import type { ModeStore } from '../mode/mode-store'
import { getServerRuntime, startServerRuntime, stopServerRuntime } from '../runtime/server-runtime'
import { getClientRuntime, connectClientRuntime, disconnectClientRuntime } from '../runtime/client-runtime'
import {
  getPreferredLanAddress,
  listLocalIpv4Addresses
} from '../network/local-ips'

export interface IpcContext {
  modeStore: ModeStore
  getMainWindow: () => BrowserWindow | null
}

/**
 * Enregistrement centralisé des handlers IPC.
 * Chaque canal retourne { ok, data } | { ok: false, error }.
 */
export function registerIpcHandlers(ctx: IpcContext): void {
  const wrap = <T>(fn: () => Promise<T> | T) => {
    return async () => {
      try {
        const data = await fn()
        return { ok: true as const, data }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false as const, error: message }
      }
    }
  }

  ipcMain.handle(
    IpcChannels.APP_GET_INFO,
    wrap((): AppRuntimeInfo => ({
      version: APP_VERSION,
      platform: process.platform,
      mode: ctx.modeStore.get()?.mode ?? null,
      userDataPath: app.getPath('userData')
    }))
  )

  ipcMain.handle(IpcChannels.MODE_GET, wrap(() => ctx.modeStore.get()))

  ipcMain.handle(IpcChannels.MODE_SET, async (_e, config: ModeConfig) => {
    try {
      // Arrête l'ancien runtime (évite EADDRINUSE / double connexion)
      await stopServerRuntime()
      await disconnectClientRuntime()

      ctx.modeStore.set(config)

      if (config.mode === 'server') {
        await startServerRuntime()
      } else {
        // Client : démarre même si le serveur est momentanément injoignable
        // (données en file locale jusqu'à sync)
        await connectClientRuntime({
          username: config.username!,
          workstation: config.workstation!,
          serverHost: config.serverHost!,
          serverPort: config.serverPort ?? DEFAULT_SERVER_PORT
        })
      }

      return { ok: true as const, data: config }
    } catch (err) {
      ctx.modeStore.clear()
      const message = err instanceof Error ? err.message : String(err)
      const friendly = /EADDRINUSE/i.test(message)
        ? `Le port ${DEFAULT_SERVER_PORT} est déjà utilisé. Fermez l'autre instance de JudoVACapp puis réessayez.`
        : message
      return { ok: false as const, error: friendly }
    }
  })

  ipcMain.handle(
    IpcChannels.MODE_CLEAR,
    wrap(async () => {
      await stopServerRuntime()
      await disconnectClientRuntime()
      ctx.modeStore.clear()
      return true
    })
  )

  ipcMain.handle(IpcChannels.SERVER_STATUS, wrap(() => getServerRuntime().getStatus()))
  ipcMain.handle(
    IpcChannels.CLIENT_STATUS,
    wrap(async () => {
      await getClientRuntime().refreshConnected()
      return getClientRuntime().getStatus()
    })
  )

  ipcMain.handle(
    IpcChannels.DASHBOARD_STATS,
    wrap(async () => {
      const mode = ctx.modeStore.get()?.mode
      if (mode === 'server') return getServerRuntime().getDashboardStats()
      return getClientRuntime().getDashboardStats()
    })
  )

  ipcMain.handle(
    IpcChannels.SYNC_FLUSH,
    wrap(async () => {
      const mode = ctx.modeStore.get()
      if (!mode || mode.mode !== 'client') {
        throw new Error('Réservé au mode Client')
      }
      if (!mode.serverHost || !mode.username || !mode.workstation) {
        throw new Error('Configuration client incomplète (IP / utilisateur / poste)')
      }
      getClientRuntime().setConnectOptions({
        username: mode.username,
        workstation: mode.workstation,
        serverHost: mode.serverHost,
        serverPort: mode.serverPort ?? DEFAULT_SERVER_PORT
      })
      return getClientRuntime().forceSync()
    })
  )

  ipcMain.handle(IpcChannels.SYNC_QUEUE_SIZE, wrap(() => getClientRuntime().getStatus().queueSize))

  ipcMain.handle(
    IpcChannels.SYNC_REGISTERED_COUNT,
    wrap(async () => {
      const count = await getClientRuntime().countRegistered()
      return { count, queueSize: getClientRuntime().getStatus().queueSize }
    })
  )

  ipcMain.handle(
    IpcChannels.SYNC_QUEUE_CLEAR,
    wrap(() => {
      const mode = ctx.modeStore.get()
      if (!mode || mode.mode !== 'client') {
        throw new Error('Réservé au mode Client')
      }
      return getClientRuntime().clearLocalPending()
    })
  )

  ipcMain.handle(IpcChannels.JUDOKA_CREATE, async (_e, body: unknown) => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode) return { ok: false as const, error: 'Mode non configuré' }

      if (mode.mode === 'client') {
        const force = Boolean((body as { force?: boolean })?.force)
        const payload = {
          ...(body as object),
          createdBy: mode.username,
          createdWorkstation: mode.workstation
        }
        const result = await getClientRuntime().enqueueJudoka(payload, force)
        return {
          ok: true as const,
          data: {
            queued: true,
            local: !result.synced,
            ...result
          }
        }
      }

      const { getContainer } = await import('@server/container')
      const c = getContainer()
      if (!c.createJudoka) {
        return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
      }
      const force = Boolean((body as { force?: boolean })?.force)
      const data = await c.createJudoka.execute(
        {
          ...(body as object),
          createdBy: (body as { createdBy?: string }).createdBy ?? 'serveur',
          createdWorkstation:
            (body as { createdWorkstation?: string }).createdWorkstation ?? 'local'
        },
        { force }
      )
      return { ok: true as const, data }
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown }
      return {
        ok: false as const,
        error: e.message ?? String(err),
        code: e.code,
        details: e.details
      }
    }
  })

  ipcMain.handle(IpcChannels.JUDOKA_GET, async (_e, id: string) => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode) return { ok: false as const, error: 'Mode non configuré' }

      if (mode.mode === 'server') {
        const { getContainer } = await import('@server/container')
        const c = getContainer()
        if (!c.getJudoka) return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        const judoka = await c.getJudoka.execute(id)
        return { ok: true as const, data: judoka }
      }

      const port = mode.serverPort ?? DEFAULT_SERVER_PORT
      const res = await fetch(`http://${mode.serverHost}:${port}/api/judokas/${id}`)
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { judoka: unknown }
      return { ok: true as const, data: data.judoka }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.JUDOKA_UPDATE, async (_e, payload: { id: string; body: unknown }) => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode) return { ok: false as const, error: 'Mode non configuré' }

      const force = Boolean((payload.body as { force?: boolean })?.force)
      const body = {
        ...(typeof payload.body === 'object' && payload.body ? payload.body : {}),
        id: payload.id
      }

      if (mode.mode === 'client') {
        const result = await getClientRuntime().enqueueJudoka(
          {
            ...body,
            createdBy: mode.username,
            createdWorkstation: mode.workstation
          },
          force
        )
        return {
          ok: true as const,
          data: {
            queued: true,
            local: !result.synced,
            ...result
          }
        }
      }

      const { getContainer } = await import('@server/container')
      const c = getContainer()
      if (!c.updateJudoka) {
        return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
      }
      const data = await c.updateJudoka.execute(payload.id, body, { force })
      return { ok: true as const, data }
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown }
      return {
        ok: false as const,
        error: e.message ?? String(err),
        code: e.code,
        details: e.details
      }
    }
  })

  ipcMain.handle(IpcChannels.JUDOKA_DELETE, async (_e, id: string) => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode) return { ok: false as const, error: 'Mode non configuré' }

      if (mode.mode === 'client') {
        const result = await getClientRuntime().enqueueDelete(id, mode.username)
        return { ok: true as const, data: { queued: true, ...result } }
      }

      const { getContainer } = await import('@server/container')
      const c = getContainer()
      if (!c.deleteJudoka) {
        return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
      }
      await c.deleteJudoka.execute(id, 'serveur')
      return { ok: true as const, data: true }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      return { ok: false as const, error: e.message ?? String(err), code: e.code }
    }
  })

  ipcMain.handle(IpcChannels.JUDOKA_LIST, async (_e, opts?: { limit?: number; offset?: number }) => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode) return { ok: false as const, error: 'Mode non configuré' }

      if (mode.mode === 'server') {
        const { getContainer } = await import('@server/container')
        const c = getContainer()
        if (!c.listJudoka) {
          return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        }
        const items = await c.listJudoka.execute(opts?.limit ?? 100, opts?.offset ?? 0)
        const total = c.getJudokaStats ? (await c.getJudokaStats.execute()).total : items.length
        return { ok: true as const, data: { items, total } }
      }

      // Client : uniquement les judokas enregistrés par ce compte
      const port = mode.serverPort ?? DEFAULT_SERVER_PORT
      const creator = String(mode.username ?? '').trim()
      const params = new URLSearchParams({
        q: '',
        createdBy: creator,
        limit: String(opts?.limit ?? 100),
        offset: String(opts?.offset ?? 0)
      })
      const url = `http://${mode.serverHost}:${port}/api/judokas/search?${params.toString()}`
      const res = await fetch(url)
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { items: unknown[] }
      const items = data.items ?? []
      return { ok: true as const, data: { items, total: items.length } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IpcChannels.JUDOKA_SEARCH,
    async (_e, payload: { query: string; filters?: Record<string, string> }) => {
      try {
        const mode = ctx.modeStore.get()
        if (!mode) return { ok: false as const, error: 'Mode non configuré' }

        if (mode.mode === 'server') {
          const { getContainer } = await import('@server/container')
          const c = getContainer()
          if (!c.searchJudoka) {
            return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
          }
          const items = await c.searchJudoka.execute(payload.query ?? '', payload.filters)
          return { ok: true as const, data: { items } }
        }

        // Client : forcer le filtre sur son propre compte (ignore tout autre createdBy)
        const port = mode.serverPort ?? DEFAULT_SERVER_PORT
        const params = new URLSearchParams({ q: payload.query ?? '' })
        for (const [k, v] of Object.entries(payload.filters ?? {})) {
          if (v && k !== 'createdBy') params.set(k, v)
        }
        params.set('createdBy', String(mode.username ?? '').trim())
        const url = `http://${mode.serverHost}:${port}/api/judokas/search?${params.toString()}`
        const res = await fetch(url)
        if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
        const data = (await res.json()) as { items: unknown[] }
        return { ok: true as const, data }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(IpcChannels.JUDOKA_CREATORS, async () => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode) return { ok: false as const, error: 'Mode non configuré' }

      if (mode.mode === 'server') {
        const { getContainer } = await import('@server/container')
        const { clientRegistry } = await import('@server/client-registry')
        const c = getContainer()
        if (!c.judokaRepo || !('listCreators' in c.judokaRepo)) {
          return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        }
        const connected = clientRegistry.list().map((cl) => cl.username)
        const items = (
          c.judokaRepo as { listCreators(usernames?: string[]): string[] }
        ).listCreators(connected)
        return { ok: true as const, data: { items } }
      }

      const port = mode.serverPort ?? DEFAULT_SERVER_PORT
      const url = `http://${mode.serverHost}:${port}/api/judokas/creators`
      const res = await fetch(url)
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { items: string[] }
      return { ok: true as const, data }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IpcChannels.JUDOKA_DELETE_CREATOR,
    async (_e, payload: { username: string; keepJudokas: boolean }) => {
      try {
        const mode = ctx.modeStore.get()
        if (!mode || mode.mode !== 'server') {
          return { ok: false as const, error: 'Réservé au mode Serveur' }
        }
        const username = String(payload?.username ?? '').trim()
        if (!username || username.toLowerCase() === 'serveur') {
          return { ok: false as const, error: 'Impossible de supprimer l’utilisateur Serveur' }
        }

        const { getContainer } = await import('@server/container')
        const { clientRegistry } = await import('@server/client-registry')
        const c = getContainer()
        if (!c.judokaRepo || !('deleteCreator' in c.judokaRepo)) {
          return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        }

        const result = (
          c.judokaRepo as {
            deleteCreator(
              label: string,
              keepJudokas: boolean
            ): { reassigned: number; deleted: number }
          }
        ).deleteCreator(username, Boolean(payload.keepJudokas))

        // Supprimer aussi le compte utilisateur s'il existe
        c.userAccounts.deleteByUsername(username)

        // Déconnecter les postes client portant ce nom d’utilisateur
        for (const client of clientRegistry.list()) {
          if (client.username.trim().toLowerCase() === username.toLowerCase()) {
            clientRegistry.delete(client.socketId)
          }
        }

        await c.logger.log(
          'info',
          'user.delete',
          payload.keepJudokas
            ? `Utilisateur ${username} supprimé — ${result.reassigned} judoka(s) réattribué(s) au serveur`
            : `Utilisateur ${username} supprimé avec ${result.deleted} judoka(s)`,
          { actor: 'serveur' }
        )

        return { ok: true as const, data: result }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IpcChannels.JUDOKA_RESET,
    async (_e, payload: { scope: 'all' | 'server' | 'client'; username?: string }) => {
      try {
        const mode = ctx.modeStore.get()
        if (!mode || mode.mode !== 'server') {
          return { ok: false as const, error: 'Réservé au mode Serveur' }
        }

        const { getContainer } = await import('@server/container')
        const c = getContainer()
        if (!c.jsonRepo) {
          return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        }

        const scope = payload?.scope
        let deleted = 0

        if (scope === 'all') {
          deleted = c.jsonRepo.resetAll()
          await c.logger.log('warn', 'judoka.reset', `Réinitialisation totale — ${deleted} judoka(s) effacé(s)`, {
            actor: 'serveur'
          })
        } else if (scope === 'server') {
          deleted = c.jsonRepo.resetByCreator('Serveur')
          await c.logger.log(
            'warn',
            'judoka.reset',
            `Réinitialisation Serveur — ${deleted} judoka(s) effacé(s)`,
            { actor: 'serveur' }
          )
        } else if (scope === 'client') {
          const username = String(payload?.username ?? '').trim()
          if (!username || username.toLowerCase() === 'serveur') {
            return { ok: false as const, error: 'Sélectionnez un compte client valide' }
          }
          deleted = c.jsonRepo.resetByCreator(username)
          await c.logger.log(
            'warn',
            'judoka.reset',
            `Réinitialisation client ${username} — ${deleted} judoka(s) effacé(s)`,
            { actor: 'serveur' }
          )
        } else {
          return { ok: false as const, error: 'Portée de réinitialisation invalide' }
        }

        // Toujours confirmer le succès (même si 0 ligne) pour que le bouton Confirmer ferme le modal
        return { ok: true as const, data: { deleted, scope: scope as string } }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(IpcChannels.LOG_LIST, async (_e, limit?: number) => {
    try {
      const { getContainer } = await import('@server/container')
      const items = await getContainer().logger.list(limit ?? 50)
      return { ok: true as const, data: { items } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.LOG_CLEAR, async () => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode || mode.mode !== 'server') {
        return { ok: false as const, error: 'Réservé au mode Serveur' }
      }
      const { getContainer } = await import('@server/container')
      await getContainer().logger.clear()
      await getContainer().logger.log('info', 'log.clear', 'Journal effacé', { actor: 'serveur' })
      return { ok: true as const, data: true }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.USER_LIST, async () => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode || mode.mode !== 'server') {
        return { ok: false as const, error: 'Réservé au mode Serveur' }
      }
      const { getContainer } = await import('@server/container')
      return { ok: true as const, data: { items: getContainer().userAccounts.list() } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.USER_CREATE, async (_e, payload: { username: string; displayName?: string }) => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode || mode.mode !== 'server') {
        return { ok: false as const, error: 'Réservé au mode Serveur' }
      }
      const { getContainer } = await import('@server/container')
      const account = getContainer().userAccounts.create(payload.username, payload.displayName)
      await getContainer().logger.log(
        'info',
        'user.create',
        `Compte client créé : ${account.username}`,
        { actor: 'serveur' }
      )
      return { ok: true as const, data: account }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.USER_DELETE, async (_e, username: string) => {
    try {
      const mode = ctx.modeStore.get()
      if (!mode || mode.mode !== 'server') {
        return { ok: false as const, error: 'Réservé au mode Serveur' }
      }
      const { getContainer } = await import('@server/container')
      const ok = getContainer().userAccounts.deleteByUsername(String(username ?? ''))
      if (!ok) return { ok: false as const, error: 'Compte introuvable' }
      await getContainer().logger.log(
        'info',
        'user.delete-account',
        `Compte client supprimé : ${username}`,
        { actor: 'serveur' }
      )
      return { ok: true as const, data: true }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IpcChannels.NETWORK_LOCAL_INFO,
    wrap(() => {
      const addresses = listLocalIpv4Addresses()
      const status = getServerRuntime().getStatus()
      return {
        addresses,
        preferredAddress: getPreferredLanAddress(addresses),
        port: status.port
      }
    })
  )

  // ——— Photo ———
  ipcMain.handle(IpcChannels.PHOTO_SAVE_DATA_URL, async (_e, dataUrl: string) => {
    try {
      const { PhotoStorage, decodeDataUrl } = await import(
        '@core/infrastructure/storage/photo-storage'
      )
      const storage = new PhotoStorage()
      const path = storage.saveBuffer(decodeDataUrl(dataUrl), 'webcam.jpg')
      return { ok: true as const, data: { path, dataUrl } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.PHOTO_READ_DATA_URL, async (_e, filePath: string) => {
    try {
      const { readFileSync, existsSync } = await import('fs')
      const { extname } = await import('path')
      if (!filePath || !existsSync(filePath)) {
        return { ok: false as const, error: 'Fichier photo introuvable' }
      }
      const ext = extname(filePath).toLowerCase().replace('.', '') || 'jpeg'
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      const dataUrl = `data:${mime};base64,${readFileSync(filePath).toString('base64')}`
      return { ok: true as const, data: { dataUrl } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IpcChannels.SYNC_QUEUE_LIST,
    wrap(() => ({
      items: getClientRuntime().listQueue()
    }))
  )

  ipcMain.handle(IpcChannels.PHOTO_IMPORT_FILE, async (_e, sourcePath: string) => {
    try {
      const { PhotoStorage } = await import('@core/infrastructure/storage/photo-storage')
      const path = new PhotoStorage().importFile(sourcePath)
      return { ok: true as const, data: { path } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.DIALOG_OPEN_IMAGE, async () => {
    try {
      const { dialog } = await import('electron')
      const win = ctx.getMainWindow()
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        title: 'Importer une photo',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: true as const, data: { path: null as string | null, dataUrl: null as string | null } }
      }
      const { PhotoStorage } = await import('@core/infrastructure/storage/photo-storage')
      const { readFileSync } = await import('fs')
      const { extname } = await import('path')
      const path = new PhotoStorage().importFile(result.filePaths[0])
      const ext = extname(path).toLowerCase().replace('.', '') || 'jpeg'
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
      const dataUrl = `data:${mime};base64,${readFileSync(path).toString('base64')}`
      return { ok: true as const, data: { path, dataUrl } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ——— Badge template ———
  ipcMain.handle(IpcChannels.BADGE_TEMPLATE_GET, wrap(async () => {
    const { BadgeTemplateStore } = await import(
      '@core/infrastructure/badge/badge-template-store'
    )
    return new BadgeTemplateStore().get()
  }))

  ipcMain.handle(IpcChannels.BADGE_TEMPLATE_SET, async (_e, template) => {
    try {
      const { BadgeTemplateStore } = await import(
        '@core/infrastructure/badge/badge-template-store'
      )
      const saved = new BadgeTemplateStore().set(template)
      // Diffusion LAN si serveur actif
      try {
        const { getIo } = await import('@server/bootstrap')
        const { SocketEvents } = await import('@shared/constants/socket-events')
        getIo()?.emit(SocketEvents.BADGE_TEMPLATE_CHANGED, saved)
      } catch {
        /* serveur non démarré */
      }
      return { ok: true as const, data: saved }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.BADGE_TEMPLATE_LIST, wrap(async () => {
    const { BadgeTemplateStore } = await import(
      '@core/infrastructure/badge/badge-template-store'
    )
    const store = new BadgeTemplateStore()
    return { items: store.list(), activeId: store.getActive().id }
  }))

  ipcMain.handle(IpcChannels.BADGE_TEMPLATE_CREATE, async (_e, name?: string) => {
    try {
      const { BadgeTemplateStore } = await import(
        '@core/infrastructure/badge/badge-template-store'
      )
      const created = new BadgeTemplateStore().create(name)
      try {
        const { getIo } = await import('@server/bootstrap')
        const { SocketEvents } = await import('@shared/constants/socket-events')
        getIo()?.emit(SocketEvents.BADGE_TEMPLATE_CHANGED, created)
      } catch {
        /* ignore */
      }
      return { ok: true as const, data: created }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.BADGE_TEMPLATE_DELETE, async (_e, id: string) => {
    try {
      const { BadgeTemplateStore } = await import(
        '@core/infrastructure/badge/badge-template-store'
      )
      const active = new BadgeTemplateStore().delete(id)
      try {
        const { getIo } = await import('@server/bootstrap')
        const { SocketEvents } = await import('@shared/constants/socket-events')
        getIo()?.emit(SocketEvents.BADGE_TEMPLATE_CHANGED, active)
      } catch {
        /* ignore */
      }
      return { ok: true as const, data: active }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.BADGE_TEMPLATE_SET_ACTIVE, async (_e, id: string) => {
    try {
      const { BadgeTemplateStore } = await import(
        '@core/infrastructure/badge/badge-template-store'
      )
      const active = new BadgeTemplateStore().setActive(id)
      try {
        const { getIo } = await import('@server/bootstrap')
        const { SocketEvents } = await import('@shared/constants/socket-events')
        getIo()?.emit(SocketEvents.BADGE_TEMPLATE_CHANGED, active)
      } catch {
        /* ignore */
      }
      return { ok: true as const, data: active }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ——— PDF badges ———
  ipcMain.handle(
    IpcChannels.PDF_EXPORT_BADGES,
    async (
      _e,
      opts: {
        judokaIds?: string[]
        all?: boolean
        createdBy?: string
        perPage?: 4 | 6 | 8 | 'custom'
        customCols?: number
        customRows?: number
      }
    ) => {
      try {
        const { dialog } = await import('electron')
        const win = ctx.getMainWindow()
        const save = await dialog.showSaveDialog(win ?? undefined!, {
          title: 'Exporter les badges PDF',
          defaultPath: `badges-judovac.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (save.canceled || !save.filePath) {
          return { ok: false as const, error: 'Export annulé' }
        }

        const { BadgeTemplateStore } = await import(
          '@core/infrastructure/badge/badge-template-store'
        )
        const template = new BadgeTemplateStore().get()

        const { getContainer } = await import('@server/container')
        const c = getContainer()
        if (!c.listJudoka || !c.judokaRepo) {
          return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        }

        let judokas
        if (opts.all) {
          judokas = await c.listJudoka.execute(50_000, 0)
        } else if (opts.createdBy) {
          if (!('listByCreator' in c.judokaRepo)) {
            return { ok: false as const, error: 'Filtrage par utilisateur indisponible' }
          }
          judokas = (
            c.judokaRepo as { listByCreator(label: string): Judoka[] }
          ).listByCreator(opts.createdBy)
        } else if (opts.judokaIds?.length) {
          const found = await Promise.all(opts.judokaIds.map((id) => c.judokaRepo!.findById(id)))
          judokas = found.filter(Boolean) as NonNullable<(typeof found)[number]>[]
        } else {
          judokas = await c.listJudoka.execute(50_000, 0)
        }

        const { exportBadgesPdf } = await import('@core/infrastructure/pdf/badge-pdf')
        const path = await exportBadgesPdf({
          outputPath: save.filePath,
          template,
          judokas,
          perPage: opts.perPage ?? 4,
          customCols: opts.customCols,
          customRows: opts.customRows
        })

        try {
          await getContainer().logger.log('info', 'pdf.export', `Export PDF: ${path}`, {
            meta: { count: judokas.length, perPage: opts.perPage ?? 4 }
          })
        } catch {
          /* ignore */
        }

        return { ok: true as const, data: { path, count: judokas.length } }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ——— Sauvegarde .jvac ———
  ipcMain.handle(IpcChannels.BACKUP_EXPORT, async () => {
    try {
      const mode = ctx.modeStore.get()?.mode
      if (mode !== 'server') {
        return { ok: false as const, error: 'Export disponible en mode Serveur uniquement' }
      }
      const { dialog, app: electronApp } = await import('electron')
      const win = ctx.getMainWindow()
      const save = await dialog.showSaveDialog(win ?? undefined!, {
        title: 'Exporter sauvegarde',
        defaultPath: `judovac-${new Date().toISOString().slice(0, 10)}.jvac`,
        filters: [{ name: 'JudoVACapp Backup', extensions: ['jvac'] }]
      })
      if (save.canceled || !save.filePath) {
        return { ok: false as const, error: 'Export annulé' }
      }

      const { getContainer } = await import('@server/container')
      const c = getContainer()
      if (!c.dbReady || !c.jsonRepo) {
        return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
      }

      const { join } = await import('path')
      const userData = electronApp.getPath('userData')
      const photosDir = join(userData, 'photos')
      const assetsDir = join(userData, 'assets')

      const { exportJvacFromTables } = await import('@core/infrastructure/backup/jvac-format')
      const { SettingsStore } = await import('@core/infrastructure/settings/settings-store')
      const settings = await new SettingsStore().get()
      const logs = await c.logger.list(500)
      let badgeTemplates: unknown[] = []
      try {
        const { BadgeTemplateStore } = await import(
          '@core/infrastructure/badge/badge-template-store'
        )
        badgeTemplates = new BadgeTemplateStore().list()
      } catch {
        badgeTemplates = []
      }
      const manifest = await exportJvacFromTables({
        outputPath: save.filePath,
        photosDir,
        assetsDir,
        appVersion: APP_VERSION,
        tables: {
          judokas: c.jsonRepo.dumpAll(),
          system_logs: logs,
          settings: [{ key: 'app.settings', value: settings }],
          badge_templates: badgeTemplates,
          user_accounts: c.userAccounts.list()
        }
      })

      await c.logger.log('info', 'backup.export', `Sauvegarde créée`, {
        meta: { path: save.filePath, ...manifest.counts }
      })

      return { ok: true as const, data: { path: save.filePath, manifest } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.BACKUP_PICK, async () => {
    try {
      const mode = ctx.modeStore.get()?.mode
      if (mode !== 'server') {
        return { ok: false as const, error: 'Restauration disponible en mode Serveur uniquement' }
      }
      const { dialog } = await import('electron')
      const win = ctx.getMainWindow()
      const open = await dialog.showOpenDialog(win ?? undefined!, {
        title: 'Choisir une sauvegarde',
        properties: ['openFile'],
        filters: [{ name: 'JudoVACapp Backup', extensions: ['jvac'] }]
      })
      if (open.canceled || !open.filePaths[0]) {
        return { ok: false as const, error: 'Sélection annulée' }
      }

      const { readJvacBundle } = await import('@core/infrastructure/backup/jvac-format')
      const bundle = readJvacBundle(open.filePaths[0])
      return {
        ok: true as const,
        data: { path: open.filePaths[0], manifest: bundle.manifest }
      }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IpcChannels.BACKUP_IMPORT,
    async (_event, payload: { path: string; mode: 'replace' | 'merge' }) => {
      try {
        const mode = ctx.modeStore.get()?.mode
        if (mode !== 'server') {
          return { ok: false as const, error: 'Restauration disponible en mode Serveur uniquement' }
        }
        const filePath = String(payload?.path ?? '')
        const importMode = payload?.mode === 'merge' ? 'merge' : 'replace'
        if (!filePath) {
          return { ok: false as const, error: 'Fichier de sauvegarde manquant' }
        }

        const { getContainer } = await import('@server/container')
        const c = getContainer()
        if (!c.dbReady || !c.jsonRepo) {
          return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        }

        const { app: electronApp } = await import('electron')
        const { join } = await import('path')
        const userData = electronApp.getPath('userData')
        const photosDir = join(userData, 'photos')
        const assetsDir = join(userData, 'assets')

        const { readJvacBundle, restoreJvacFiles } = await import(
          '@core/infrastructure/backup/jvac-format'
        )
        const { computeAge } = await import('@shared/utils/judoka')
        const bundle = readJvacBundle(filePath)
        restoreJvacFiles(bundle, photosDir, assetsDir)

        const items = bundle.tables.judokas.map((row) => normalizeImportedJudoka(row, computeAge))
        let mergeStats: { added: number; skipped: number } | undefined
        if (importMode === 'merge') {
          mergeStats = c.jsonRepo.mergeAll(items)
        } else {
          c.jsonRepo.replaceAll(items)
        }

        const rawAccounts = bundle.tables.user_accounts ?? []
        const accounts = rawAccounts
          .map((row) => normalizeImportedUserAccount(row))
          .filter((a): a is UserAccount => a !== null)
        if (importMode === 'merge') {
          c.userAccounts.mergeAll(accounts)
        } else if (accounts.length > 0) {
          c.userAccounts.replaceAll(accounts)
        }

        if (importMode === 'replace') {
          const { SettingsStore } = await import('@core/infrastructure/settings/settings-store')
          const settingsRow = bundle.tables.settings[0] as { value?: unknown } | undefined
          if (settingsRow?.value) {
            await new SettingsStore().set(
              typeof settingsRow.value === 'object' && settingsRow.value
                ? (settingsRow.value as never)
                : {}
            )
          }
        }

        const manifest = bundle.manifest

        await c.logger.log('info', 'backup.import', `Restauration terminée (${importMode})`, {
          meta: { path: filePath, mode: importMode, ...manifest.counts, ...mergeStats }
        })

        return {
          ok: true as const,
          data: { path: filePath, manifest, mode: importMode, mergeStats }
        }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ——— Paramètres / Admin ———
  ipcMain.handle(IpcChannels.SETTINGS_GET, async () => {
    try {
      const { SettingsStore } = await import('@core/infrastructure/settings/settings-store')
      const settings = await new SettingsStore().get()
      return { ok: true as const, data: settings }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.SETTINGS_SET, async (_e, patch) => {
    try {
      const { SettingsStore } = await import('@core/infrastructure/settings/settings-store')
      const { getContainer } = await import('@server/container')
      let logger = null as Awaited<ReturnType<typeof getContainer>>['logger'] | null
      try {
        logger = getContainer().logger
      } catch {
        /* store sans serveur */
      }
      const settings = await new SettingsStore().set(patch)
      await logger?.log('info', 'settings.update', 'Paramètres mis à jour', {
        meta: { keys: Object.keys(patch as object) }
      })
      try {
        const { getIo } = await import('@server/bootstrap')
        const { SocketEvents } = await import('@shared/constants/socket-events')
        getIo()?.emit(SocketEvents.SETTINGS_CHANGED, settings)
      } catch {
        /* ignore */
      }
      return { ok: true as const, data: settings }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ——— Impression ———
  ipcMain.handle(IpcChannels.PRINT_LIST_PRINTERS, async () => {
    try {
      const { listPrinters } = await import('@core/infrastructure/print/print-service')
      const printers = await listPrinters()
      return { ok: true as const, data: { printers } }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IpcChannels.PRINT_BADGE,
    async (
      _e,
      opts: {
        all?: boolean
        judokaIds?: string[]
        printerName?: string
        copies?: number
        silent?: boolean
        perPage?: 4 | 6 | 8
      }
    ) => {
      try {
        const mode = ctx.modeStore.get()?.mode
        if (mode !== 'server') {
          return { ok: false as const, error: 'Impression réservée au mode Serveur' }
        }
        const { getContainer } = await import('@server/container')
        const c = getContainer()
        if (!c.listJudoka || !c.judokaRepo) {
          return { ok: false as const, error: c.dbError ?? 'Stockage local indisponible' }
        }

        let judokas
        if (opts.all || !opts.judokaIds?.length) {
          judokas = await c.listJudoka.execute(50_000, 0)
        } else {
          const found = await Promise.all(opts.judokaIds.map((id) => c.judokaRepo!.findById(id)))
          judokas = found.filter(Boolean) as NonNullable<(typeof found)[number]>[]
        }
        if (judokas.length === 0) {
          return { ok: false as const, error: 'Aucun judoka à imprimer' }
        }

        const { BadgeTemplateStore } = await import(
          '@core/infrastructure/badge/badge-template-store'
        )
        const { SettingsStore } = await import('@core/infrastructure/settings/settings-store')
        const template = new BadgeTemplateStore().get()
        const settings = await new SettingsStore().get()

        const { printBadges } = await import('@core/infrastructure/print/print-service')
        const result = await printBadges({
          judokas,
          template,
          printerName: opts.printerName || settings.print.defaultPrinter || undefined,
          copies: opts.copies ?? settings.print.copies,
          silent: opts.silent ?? settings.print.silent,
          perPage: opts.perPage ?? 4
        })

        await c.logger.log('info', 'print.badge', `Impression ${judokas.length} badge(s)`, {
          meta: { printer: opts.printerName, path: result.pdfPath }
        })

        return { ok: true as const, data: { ...result, count: judokas.length } }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ——— Assets badge (background / logo) ———
  ipcMain.handle(
    IpcChannels.BADGE_IMPORT_ASSET,
    async (_e, kind: 'background' | 'logo') => {
      try {
        const { dialog, app: electronApp } = await import('electron')
        const { copyFileSync, existsSync, mkdirSync } = await import('fs')
        const { join, extname } = await import('path')
        const { randomUUID } = await import('crypto')

        const win = ctx.getMainWindow()
        const open = await dialog.showOpenDialog(win ?? undefined!, {
          title: kind === 'background' ? 'Importer un fond de badge' : 'Importer un logo',
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
        })
        if (open.canceled || !open.filePaths[0]) {
          return { ok: true as const, data: { path: null as string | null } }
        }

        const assetsDir = join(electronApp.getPath('userData'), 'assets')
        if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true })
        const ext = extname(open.filePaths[0]).toLowerCase() || '.png'
        const dest = join(assetsDir, `${kind}-${randomUUID()}${ext}`)
        copyFileSync(open.filePaths[0], dest)

        const { BadgeTemplateStore } = await import(
          '@core/infrastructure/badge/badge-template-store'
        )
        const store = new BadgeTemplateStore()
        const current = store.get()
        const updated = store.set({
          ...current,
          ...(kind === 'background' ? { backgroundPath: dest } : { logoPath: dest })
        })

        try {
          const { getIo } = await import('@server/bootstrap')
          const { SocketEvents } = await import('@shared/constants/socket-events')
          getIo()?.emit(SocketEvents.BADGE_TEMPLATE_CHANGED, updated)
        } catch {
          /* ignore */
        }

        return { ok: true as const, data: { path: dest, template: updated } }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}

function normalizeImportedUserAccount(row: unknown): UserAccount | null {
  const r = row as Record<string, unknown>
  const username = String(r.username ?? '').trim()
  if (!username) return null
  return {
    id: String(r.id ?? randomUUID()),
    username,
    displayName: r.displayName ? String(r.displayName) : undefined,
    active: r.active !== false,
    createdAt: String(r.createdAt ?? new Date().toISOString())
  }
}

function normalizeImportedJudoka(
  row: unknown,
  computeAge: (birthDate: string) => number
): import('@shared/types/judoka').Judoka {
  const r = row as Record<string, unknown>
  const pick = (camel: string, snake: string) =>
    (r[camel] !== undefined ? r[camel] : r[snake]) as string | number | null | undefined

  const birthDate = String(pick('birthDate', 'birth_date') ?? '').slice(0, 10)
  return {
    id: String(pick('id', 'id') ?? randomUUID()),
    displayId: String(pick('displayId', 'display_id') ?? 'JV-IMPORT'),
    lastName: String(pick('lastName', 'last_name') ?? ''),
    middleName: String(pick('middleName', 'middle_name') ?? ''),
    firstName: String(pick('firstName', 'first_name') ?? ''),
    sex: (pick('sex', 'sex') === 'F' ? 'F' : 'M') as 'M' | 'F',
    birthDate,
    age: computeAge(birthDate),
    province: String(pick('province', 'province') ?? ''),
    city: String(pick('city', 'city') ?? ''),
    commune: String(pick('commune', 'commune') ?? ''),
    address: String(pick('address', 'address') ?? ''),
    phone: String(pick('phone', 'phone') ?? ''),
    email: String(pick('email', 'email') ?? ''),
    club: String(pick('club', 'club') ?? ''),
    league: String(pick('league', 'league') ?? ''),
    sportProvince: String(pick('sportProvince', 'sport_province') ?? ''),
    grade: String(pick('grade', 'grade') ?? ''),
    belt: String(pick('belt', 'belt') ?? ''),
    category: String(pick('category', 'category') ?? ''),
    weightKg: pick('weightKg', 'weight_kg') == null ? null : Number(pick('weightKg', 'weight_kg')),
    heightCm: pick('heightCm', 'height_cm') == null ? null : Number(pick('heightCm', 'height_cm')),
    licenseNumber: String(pick('licenseNumber', 'license_number') ?? ''),
    affiliationYear:
      pick('affiliationYear', 'affiliation_year') == null
        ? null
        : Number(pick('affiliationYear', 'affiliation_year')),
    photoPath: (pick('photoPath', 'photo_path') as string | null) ?? null,
    createdAt: String(pick('createdAt', 'created_at') ?? new Date().toISOString()),
    updatedAt: String(pick('updatedAt', 'updated_at') ?? new Date().toISOString()),
    createdBy: String(pick('createdBy', 'created_by') ?? 'import'),
    createdWorkstation: String(pick('createdWorkstation', 'created_workstation') ?? 'import'),
    syncStatus: 'synced',
    version: Number(pick('version', 'version') ?? 1)
  }
}
