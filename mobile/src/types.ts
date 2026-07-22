export const DEFAULT_CLOUD_BASE_URL = 'https://judo-va-capp.vercel.app'
export const DEFAULT_SERVER_PORT = 3847

export const STORAGE_MODE = '@judovac/serverMode'
export const STORAGE_SERVER_HOST = '@judovac/serverHost'
export const STORAGE_SERVER_PORT = '@judovac/serverPort'
export const STORAGE_CLOUD_URL = '@judovac/cloudUrl'

export type ServerMode = 'cloud' | 'local'

export interface BadgeVerifyPayload {
  fullName: string
  category: string
  weight: string
  sex: 'M' | 'F'
  displayId: string
}

export interface QrBadgeData {
  id?: string
  displayId?: string
  name?: string
  license?: string
}
