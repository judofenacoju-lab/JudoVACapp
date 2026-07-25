import type { DuplicateMatch, Judoka, JudokaCreateInput } from '@shared/types/judoka'

/**
 * Port repository — aucune dépendance PG / filesystem ici.
 * Implémenté dans core/infrastructure (JSON local serveur) et file client.
 */
export interface IJudokaRepository {
  create(input: JudokaCreateInput): Promise<Judoka>
  update(id: string, patch: Partial<JudokaCreateInput>): Promise<Judoka>
  delete(id: string): Promise<void>
  findById(id: string): Promise<Judoka | null>
  list(limit?: number, offset?: number): Promise<Judoka[]>
  search(query: string, filters?: JudokaSearchFilters): Promise<Judoka[]>
  findDuplicates(candidate: DuplicateCandidate): Promise<DuplicateMatch[]>
  count(): Promise<number>
}

export interface JudokaSearchFilters {
  club?: string
  province?: string
  league?: string
  grade?: string
  phone?: string
  licenseNumber?: string
  /** Libellé utilisateur affiché (ex. « Serveur », nom client). */
  createdBy?: string
}

export interface DuplicateCandidate {
  lastName: string
  firstName: string
  middleName?: string
  birthDate: string
  club?: string
  licenseNumber?: string
  excludeId?: string
}
