/** Données affichées sur le badge — utilisées par le scanner mobile. */
export interface BadgeVerifyPayload {
  fullName: string
  category: string
  weight: string
  sex: 'M' | 'F'
  displayId: string
}

export interface BadgeVerifyResponse {
  ok: true
  badge: BadgeVerifyPayload
}

export interface BadgeVerifyError {
  ok: false
  error: string
}
