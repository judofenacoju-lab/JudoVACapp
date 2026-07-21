export const DEFAULT_SERVER_PORT = 3847

export const STORAGE_SERVER_HOST = '@judovac/serverHost'
export const STORAGE_SERVER_PORT = '@judovac/serverPort'

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
