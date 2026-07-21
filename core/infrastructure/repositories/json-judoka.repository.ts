import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { computeAge } from '@shared/utils/judoka'
import type {
  DuplicateMatch,
  Judoka,
  JudokaCreateInput
} from '@shared/types/judoka'
import type {
  DuplicateCandidate,
  IJudokaRepository,
  JudokaSearchFilters
} from '@core/domain/repositories/judoka.repository'
import { NotFoundError } from '@core/domain/errors'
import { formatCreatorLabel } from '@shared/utils/creator'

interface StoreFile {
  seq: number
  items: Judoka[]
}

/**
 * Persistance judokas locale (JSON) — source de vérité du mode Serveur.
 */
export class JsonJudokaRepository implements IJudokaRepository {
  private readonly filePath: string
  private seq: number
  private items: Judoka[]

  constructor(userDataPath: string) {
    const dir = join(userDataPath, 'data')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'judokas.json')
    const loaded = this.load()
    this.seq = loaded.seq
    this.items = loaded.items
  }

  async create(input: JudokaCreateInput): Promise<Judoka> {
    const now = new Date().toISOString()
    const year = new Date().getFullYear()
    this.seq += 1
    const displayId = input.displayId ?? `JV-${year}-${String(this.seq).padStart(5, '0')}`
    const judoka: Judoka = {
      id: input.id ?? randomUUID(),
      displayId,
      lastName: input.lastName.trim(),
      middleName: (input.middleName ?? '').trim(),
      firstName: input.firstName.trim(),
      sex: input.sex,
      birthDate: input.birthDate,
      age: computeAge(input.birthDate),
      province: input.province ?? '',
      city: input.city ?? '',
      commune: input.commune ?? '',
      address: input.address ?? '',
      phone: input.phone ?? '',
      email: input.email ?? '',
      club: input.club ?? '',
      league: input.league ?? '',
      sportProvince: input.sportProvince ?? '',
      grade: input.grade ?? '',
      belt: input.belt ?? '',
      category: input.category ?? '',
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      licenseNumber: input.licenseNumber ?? '',
      affiliationYear: input.affiliationYear,
      photoPath: input.photoPath,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      createdWorkstation: input.createdWorkstation,
      syncStatus: 'synced',
      version: 1
    }
    this.items.unshift(judoka)
    this.persist()
    return judoka
  }

  async update(id: string, patch: Partial<JudokaCreateInput>): Promise<Judoka> {
    const idx = this.items.findIndex((j) => j.id === id)
    if (idx < 0) throw new NotFoundError('Judoka', id)
    const existing = this.items[idx]!
    const merged: Judoka = {
      ...existing,
      ...patch,
      id: existing.id,
      displayId: existing.displayId,
      middleName: patch.middleName ?? existing.middleName,
      province: patch.province ?? existing.province,
      city: patch.city ?? existing.city,
      commune: patch.commune ?? existing.commune,
      address: patch.address ?? existing.address,
      phone: patch.phone ?? existing.phone,
      email: patch.email ?? existing.email,
      club: patch.club ?? existing.club,
      league: patch.league ?? existing.league,
      sportProvince: patch.sportProvince ?? existing.sportProvince,
      grade: patch.grade ?? existing.grade,
      belt: patch.belt ?? existing.belt,
      category: patch.category ?? existing.category,
      licenseNumber: patch.licenseNumber ?? existing.licenseNumber,
      photoPath: patch.photoPath !== undefined ? patch.photoPath : existing.photoPath,
      birthDate: patch.birthDate ?? existing.birthDate,
      age: computeAge(patch.birthDate ?? existing.birthDate),
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
      syncStatus: 'synced',
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      createdWorkstation: existing.createdWorkstation
    }
    this.items[idx] = merged
    this.persist()
    return merged
  }

  async delete(id: string): Promise<void> {
    const before = this.items.length
    this.items = this.items.filter((j) => j.id !== id)
    if (this.items.length === before) throw new NotFoundError('Judoka', id)
    this.persist()
  }

  async findById(id: string): Promise<Judoka | null> {
    return this.items.find((j) => j.id === id) ?? null
  }

  findByDisplayId(displayId: string): Judoka | null {
    const key = displayId.trim()
    if (!key) return null
    return this.items.find((j) => j.displayId === key) ?? null
  }

  async list(limit = 100, offset = 0): Promise<Judoka[]> {
    return this.items.slice(offset, offset + limit)
  }

  async search(query: string, filters?: JudokaSearchFilters): Promise<Judoka[]> {
    const q = query.trim().toLowerCase()
    return this.items
      .filter((j) => {
        if (filters?.club && !j.club.toLowerCase().includes(filters.club.toLowerCase())) return false
        if (filters?.province && !j.province.toLowerCase().includes(filters.province.toLowerCase()))
          return false
        if (filters?.league && !j.league.toLowerCase().includes(filters.league.toLowerCase()))
          return false
        if (filters?.grade && !j.grade.toLowerCase().includes(filters.grade.toLowerCase()))
          return false
        if (filters?.phone && !j.phone.includes(filters.phone)) return false
        if (filters?.licenseNumber && !j.licenseNumber.includes(filters.licenseNumber)) return false
        if (filters?.createdBy) {
          const label = formatCreatorLabel(j.createdBy)
          if (label !== filters.createdBy) return false
        }
        if (!q) return true
        const hay = [
          j.lastName,
          j.middleName,
          j.firstName,
          j.displayId,
          j.licenseNumber,
          j.phone,
          j.club
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 200)
  }

  async findDuplicates(candidate: DuplicateCandidate): Promise<DuplicateMatch[]> {
    const matches: DuplicateMatch[] = []
    for (const j of this.items) {
      if (candidate.excludeId && j.id === candidate.excludeId) continue
      const matchedOn: DuplicateMatch['matchedOn'] = []
      const sameName =
        j.lastName.toLowerCase() === candidate.lastName.trim().toLowerCase() &&
        j.firstName.toLowerCase() === candidate.firstName.trim().toLowerCase()
      if (sameName) matchedOn.push('name')
      if (j.birthDate === candidate.birthDate) matchedOn.push('birthDate')
      if (
        candidate.licenseNumber &&
        candidate.licenseNumber.trim() &&
        j.licenseNumber &&
        j.licenseNumber === candidate.licenseNumber.trim()
      ) {
        matchedOn.push('licenseNumber')
      }
      if (
        (sameName && j.birthDate === candidate.birthDate) ||
        (candidate.licenseNumber?.trim() &&
          j.licenseNumber === candidate.licenseNumber.trim())
      ) {
        matches.push({ judoka: j, matchedOn })
      }
    }
    return matches
  }

  async count(): Promise<number> {
    return this.items.length
  }

  /** Statistiques par utilisateur — Serveur en premier. */
  countByUser(): Array<{ username: string; count: number }> {
    const map = new Map<string, number>()
    for (const j of this.items) {
      const label = formatCreatorLabel(j.createdBy)
      map.set(label, (map.get(label) ?? 0) + 1)
    }
    if (!map.has('Serveur')) map.set('Serveur', 0)
    const entries = [...map.entries()].map(([username, count]) => ({ username, count }))
    entries.sort((a, b) => {
      if (a.username === 'Serveur') return -1
      if (b.username === 'Serveur') return 1
      return a.username.localeCompare(b.username, 'fr')
    })
    return entries
  }

  /** Liste des utilisateurs ayant enregistré des judokas (+ utilisateurs connectés). */
  listCreators(extraUsernames: string[] = []): string[] {
    const set = new Set<string>(['Serveur'])
    for (const j of this.items) {
      set.add(formatCreatorLabel(j.createdBy))
    }
    for (const u of extraUsernames) {
      const trimmed = u.trim()
      if (trimmed) set.add(trimmed)
    }
    return [...set].sort((a, b) => {
      if (a === 'Serveur') return -1
      if (b === 'Serveur') return 1
      return a.localeCompare(b, 'fr')
    })
  }

  /** Judokas filtrés par libellé utilisateur. */
  listByCreator(creatorLabel: string): Judoka[] {
    return this.items.filter((j) => formatCreatorLabel(j.createdBy) === creatorLabel)
  }

  /** Efface tous les judokas (Serveur + clients). */
  resetAll(): number {
    const deleted = this.items.length
    this.items = []
    this.seq = 0
    this.persist()
    return deleted
  }

  /** Efface les judokas d'un créateur (Serveur ou client). */
  resetByCreator(creatorLabel: string): number {
    const label = formatCreatorLabel(creatorLabel)
    const before = this.items.length
    this.items = this.items.filter((j) => formatCreatorLabel(j.createdBy) !== label)
    const deleted = before - this.items.length
    if (deleted > 0) this.persist()
    return deleted
  }

  /**
   * Supprime un utilisateur client :
   * - keepJudokas=true → réattribue ses judokas au serveur
   * - keepJudokas=false → supprime ses judokas
   */
  deleteCreator(
    creatorLabel: string,
    keepJudokas: boolean
  ): { reassigned: number; deleted: number } {
    const label = formatCreatorLabel(creatorLabel)
    if (label === 'Serveur') {
      throw new Error('Impossible de supprimer l’utilisateur Serveur')
    }

    let reassigned = 0
    let deleted = 0
    const next: Judoka[] = []

    for (const j of this.items) {
      if (formatCreatorLabel(j.createdBy) !== label) {
        next.push(j)
        continue
      }
      if (keepJudokas) {
        next.push({
          ...j,
          createdBy: 'serveur',
          updatedAt: new Date().toISOString()
        })
        reassigned++
      } else {
        deleted++
      }
    }

    this.items = next
    this.persist()
    return { reassigned, deleted }
  }

  /** Dump pour sauvegarde .jvac locale. */
  dumpAll(): Judoka[] {
    return [...this.items]
  }

  replaceAll(items: Judoka[]): void {
    this.items = items
    this.seq = Math.max(
      this.seq,
      ...items.map((j) => {
        const m = /-(\d+)$/.exec(j.displayId)
        return m ? Number(m[1]) : 0
      }),
      0
    )
    this.persist()
  }

  /** Fusionne des judokas importés — conserve l'existant, ajoute les nouveaux (par id). */
  mergeAll(incoming: Judoka[]): { added: number; skipped: number } {
    const existingIds = new Set(this.items.map((j) => j.id))
    let added = 0
    let skipped = 0
    for (const j of incoming) {
      if (existingIds.has(j.id)) {
        skipped++
        continue
      }
      this.items.push(j)
      existingIds.add(j.id)
      added++
    }
    if (added > 0) {
      this.seq = Math.max(
        this.seq,
        ...incoming.map((j) => {
          const m = /-(\d+)$/.exec(j.displayId)
          return m ? Number(m[1]) : 0
        }),
        0
      )
      this.persist()
    }
    return { added, skipped }
  }

  private load(): StoreFile {
    if (!existsSync(this.filePath)) return { seq: 0, items: [] }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<StoreFile>
      return {
        seq: typeof raw.seq === 'number' ? raw.seq : 0,
        items: Array.isArray(raw.items) ? raw.items : []
      }
    } catch {
      return { seq: 0, items: [] }
    }
  }

  private persist(): void {
    const tmp = `${this.filePath}.tmp`
    const data: StoreFile = { seq: this.seq, items: this.items }
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    renameSync(tmp, this.filePath)
  }
}
