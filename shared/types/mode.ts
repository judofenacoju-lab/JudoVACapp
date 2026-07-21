export type AppMode = 'server' | 'client'

export interface ModeConfig {
  mode: AppMode
  /** Renseigné uniquement en mode client */
  username?: string
  workstation?: string
  serverHost?: string
  serverPort?: number
  /** Instantané ISO de la configuration */
  configuredAt: string
}

export type AppPlatform = NodeJS.Platform | 'web'

export interface AppRuntimeInfo {
  version: string
  platform: AppPlatform
  mode: AppMode | null
  userDataPath: string
}
