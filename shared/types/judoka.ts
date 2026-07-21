export type Sex = 'M' | 'F'

export interface Judoka {
  id: string
  /** Identifiant métier lisible (ex: JV-2026-00042) */
  displayId: string
  lastName: string
  middleName: string
  firstName: string
  sex: Sex
  birthDate: string
  age: number
  province: string
  city: string
  commune: string
  address: string
  phone: string
  email: string
  club: string
  league: string
  sportProvince: string
  grade: string
  belt: string
  category: string
  weightKg: number | null
  heightCm: number | null
  licenseNumber: string
  affiliationYear: number | null
  photoPath: string | null
  createdAt: string
  updatedAt: string
  createdBy: string
  createdWorkstation: string
  syncStatus: SyncStatus
  version: number
}

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'local'

export type JudokaCreateInput = Omit<
  Judoka,
  'id' | 'displayId' | 'age' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'version'
> & {
  id?: string
  displayId?: string
}

export interface DuplicateMatch {
  judoka: Judoka
  matchedOn: Array<'name' | 'birthDate' | 'licenseNumber'>
}
