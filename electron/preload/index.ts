import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/constants/ipc-channels'
import type { ModeConfig, AppRuntimeInfo } from '@shared/types/mode'
import type { ClientConnectionStatus, DashboardStats, ServerStatus } from '@shared/types/dashboard'
import type { Judoka } from '@shared/types/judoka'
import type { BadgeTemplate } from '@shared/types/badge'
import type { AppSettings } from '@shared/types/settings'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; details?: unknown }

export interface PrinterInfoLite {
  name: string
  displayName: string
  description: string
  isDefault: boolean
  status: number
}

const api = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>,

  getAppInfo: (): Promise<IpcResult<AppRuntimeInfo>> =>
    ipcRenderer.invoke(IpcChannels.APP_GET_INFO),

  getMode: (): Promise<IpcResult<ModeConfig | null>> =>
    ipcRenderer.invoke(IpcChannels.MODE_GET),

  setMode: (config: ModeConfig): Promise<IpcResult<ModeConfig>> =>
    ipcRenderer.invoke(IpcChannels.MODE_SET, config),

  clearMode: (): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(IpcChannels.MODE_CLEAR),

  getServerStatus: (): Promise<IpcResult<ServerStatus>> =>
    ipcRenderer.invoke(IpcChannels.SERVER_STATUS),

  getClientStatus: (): Promise<IpcResult<ClientConnectionStatus>> =>
    ipcRenderer.invoke(IpcChannels.CLIENT_STATUS),

  getDashboardStats: (): Promise<IpcResult<DashboardStats>> =>
    ipcRenderer.invoke(IpcChannels.DASHBOARD_STATS),

  createJudoka: (body: unknown): Promise<IpcResult<unknown>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_CREATE, body),

  getJudoka: (id: string): Promise<IpcResult<Judoka>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_GET, id),

  updateJudoka: (id: string, body: unknown): Promise<IpcResult<unknown>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_UPDATE, { id, body }),

  deleteJudoka: (id: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_DELETE, id),

  listJudokas: (opts?: { limit?: number; offset?: number }): Promise<
    IpcResult<{ items: Judoka[]; total: number }>
  > => ipcRenderer.invoke(IpcChannels.JUDOKA_LIST, opts),

  searchJudokas: (
    query: string,
    filters?: Record<string, string>
  ): Promise<IpcResult<{ items: Judoka[] }>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_SEARCH, { query, filters }),

  listJudokaCreators: (): Promise<IpcResult<{ items: string[] }>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_CREATORS),

  deleteJudokaCreator: (
    username: string,
    keepJudokas: boolean
  ): Promise<IpcResult<{ reassigned: number; deleted: number }>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_DELETE_CREATOR, { username, keepJudokas }),

  resetJudokas: (opts: {
    scope: 'all' | 'server' | 'client'
    username?: string
  }): Promise<IpcResult<{ deleted: number; scope: string }>> =>
    ipcRenderer.invoke(IpcChannels.JUDOKA_RESET, opts),

  flushSync: (): Promise<IpcResult<ClientConnectionStatus>> =>
    ipcRenderer.invoke(IpcChannels.SYNC_FLUSH),

  getRegisteredCount: (): Promise<IpcResult<{ count: number; queueSize: number }>> =>
    ipcRenderer.invoke(IpcChannels.SYNC_REGISTERED_COUNT),

  clearLocalSyncQueue: (): Promise<IpcResult<{ cleared: number; queueSize: number }>> =>
    ipcRenderer.invoke(IpcChannels.SYNC_QUEUE_CLEAR),

  getLogs: (limit?: number): Promise<IpcResult<{ items: DashboardStats['recentLogs'] }>> =>
    ipcRenderer.invoke(IpcChannels.LOG_LIST, limit),

  clearLogs: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IpcChannels.LOG_CLEAR),

  listUsers: (): Promise<IpcResult<{ items: import('@shared/types/user-account').UserAccount[] }>> =>
    ipcRenderer.invoke(IpcChannels.USER_LIST),

  createUser: (
    username: string,
    displayName?: string
  ): Promise<IpcResult<import('@shared/types/user-account').UserAccount>> =>
    ipcRenderer.invoke(IpcChannels.USER_CREATE, { username, displayName }),

  deleteUser: (username: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(IpcChannels.USER_DELETE, username),

  savePhotoDataUrl: (dataUrl: string): Promise<IpcResult<{ path: string; dataUrl?: string }>> =>
    ipcRenderer.invoke(IpcChannels.PHOTO_SAVE_DATA_URL, dataUrl),

  importPhotoFile: (): Promise<
    IpcResult<{ path: string | null; dataUrl?: string | null }>
  > => ipcRenderer.invoke(IpcChannels.DIALOG_OPEN_IMAGE),

  readPhotoDataUrl: (filePath: string): Promise<IpcResult<{ dataUrl: string }>> =>
    ipcRenderer.invoke(IpcChannels.PHOTO_READ_DATA_URL, filePath),

  getSyncQueue: (): Promise<
    IpcResult<{
      items: Array<{
        id: string
        operation: string
        payload: unknown
        force?: boolean
        createdAt: string
        attempts: number
        lastError?: string
      }>
    }>
  > => ipcRenderer.invoke(IpcChannels.SYNC_QUEUE_LIST),

  getBadgeTemplate: (): Promise<IpcResult<BadgeTemplate>> =>
    ipcRenderer.invoke(IpcChannels.BADGE_TEMPLATE_GET),

  setBadgeTemplate: (template: BadgeTemplate): Promise<IpcResult<BadgeTemplate>> =>
    ipcRenderer.invoke(IpcChannels.BADGE_TEMPLATE_SET, template),

  listBadgeTemplates: (): Promise<
    IpcResult<{ items: BadgeTemplate[]; activeId: string }>
  > => ipcRenderer.invoke(IpcChannels.BADGE_TEMPLATE_LIST),

  createBadgeTemplate: (name?: string): Promise<IpcResult<BadgeTemplate>> =>
    ipcRenderer.invoke(IpcChannels.BADGE_TEMPLATE_CREATE, name),

  deleteBadgeTemplate: (id: string): Promise<IpcResult<BadgeTemplate>> =>
    ipcRenderer.invoke(IpcChannels.BADGE_TEMPLATE_DELETE, id),

  setActiveBadgeTemplate: (id: string): Promise<IpcResult<BadgeTemplate>> =>
    ipcRenderer.invoke(IpcChannels.BADGE_TEMPLATE_SET_ACTIVE, id),

  importBadgeAsset: (
    kind: 'background' | 'logo'
  ): Promise<IpcResult<{ path: string | null; template?: BadgeTemplate }>> =>
    ipcRenderer.invoke(IpcChannels.BADGE_IMPORT_ASSET, kind),

  exportBadgesPdf: (opts: {
    judokaIds?: string[]
    all?: boolean
    createdBy?: string
    perPage?: 4 | 6 | 8 | 'custom'
    customCols?: number
    customRows?: number
  }): Promise<IpcResult<{ path: string; count: number }>> =>
    ipcRenderer.invoke(IpcChannels.PDF_EXPORT_BADGES, opts),

  exportBackup: (): Promise<
    IpcResult<{ path: string; manifest: { counts: Record<string, number>; checksumSha256: string } }>
  > => ipcRenderer.invoke(IpcChannels.BACKUP_EXPORT),

  pickBackupFile: (): Promise<
    IpcResult<{ path: string; manifest: { counts: Record<string, number>; createdAt: string } }>
  > => ipcRenderer.invoke(IpcChannels.BACKUP_PICK),

  importBackup: (opts: {
    path: string
    mode: 'replace' | 'merge'
  }): Promise<
    IpcResult<{
      path: string
      mode: 'replace' | 'merge'
      manifest: { counts: Record<string, number>; checksumSha256: string }
      mergeStats?: { added: number; skipped: number }
    }>
  > => ipcRenderer.invoke(IpcChannels.BACKUP_IMPORT, opts),

  getSettings: (): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_GET),

  setSettings: (patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_SET, patch),

  listPrinters: (): Promise<IpcResult<{ printers: PrinterInfoLite[] }>> =>
    ipcRenderer.invoke(IpcChannels.PRINT_LIST_PRINTERS),

  getLocalNetworkInfo: (): Promise<
    IpcResult<{
      addresses: Array<{ address: string; iface: string }>
      preferredAddress: string | null
      port: number
    }>
  > => ipcRenderer.invoke(IpcChannels.NETWORK_LOCAL_INFO),

  printBadges: (opts: {
    all?: boolean
    judokaIds?: string[]
    printerName?: string
    copies?: number
    silent?: boolean
    perPage?: 4 | 6 | 8
  }): Promise<IpcResult<{ pdfPath: string; count: number }>> =>
    ipcRenderer.invoke(IpcChannels.PRINT_BADGE, opts),

  channels: IpcChannels
}

contextBridge.exposeInMainWorld('judovac', api)

export type JudovacApi = typeof api
