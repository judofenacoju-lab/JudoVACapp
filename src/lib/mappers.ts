import type { Judoka } from '@shared/types/judoka'
import type { BadgeTemplate } from '@shared/types/badge'
import type { AppSettings } from '@shared/types/settings'
import { createDefaultSettings } from '@shared/types/settings'
import type { UserAccount } from '@shared/types/user-account'
import type { SystemLogEntry } from '@shared/types/dashboard'
import type { JudokaRow, ProfileRow } from './supabase'

export function rowToJudoka(row: JudokaRow): Judoka {
  return {
    id: row.id,
    displayId: row.display_id,
    lastName: row.last_name,
    middleName: row.middle_name,
    firstName: row.first_name,
    sex: row.sex,
    birthDate: row.birth_date,
    age: row.age,
    province: row.province,
    city: row.city,
    commune: row.commune,
    address: row.address,
    phone: row.phone,
    email: row.email,
    club: row.club,
    league: row.league,
    sportProvince: row.sport_province,
    grade: row.grade,
    belt: row.belt,
    category: row.category,
    weightKg: row.weight_kg,
    heightCm: row.height_cm,
    licenseNumber: row.license_number,
    affiliationYear: row.affiliation_year,
    photoPath: row.photo_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdWorkstation: row.created_workstation,
    syncStatus: row.sync_status as Judoka['syncStatus'],
    version: row.version
  }
}

export function judokaToRow(
  judoka: Partial<Judoka> & { lastName: string; firstName: string; sex: 'M' | 'F'; birthDate: string; createdBy: string }
): Record<string, unknown> {
  return {
    id: judoka.id,
    display_id: judoka.displayId,
    last_name: judoka.lastName,
    middle_name: judoka.middleName ?? '',
    first_name: judoka.firstName,
    sex: judoka.sex,
    birth_date: judoka.birthDate,
    age: judoka.age,
    province: judoka.province ?? '',
    city: judoka.city ?? '',
    commune: judoka.commune ?? '',
    address: judoka.address ?? '',
    phone: judoka.phone ?? '',
    email: judoka.email ?? '',
    club: judoka.club ?? '',
    league: judoka.league ?? '',
    sport_province: judoka.sportProvince ?? '',
    grade: judoka.grade ?? '',
    belt: judoka.belt ?? '',
    category: judoka.category ?? '',
    weight_kg: judoka.weightKg,
    height_cm: judoka.heightCm,
    license_number: judoka.licenseNumber ?? '',
    affiliation_year: judoka.affiliationYear,
    photo_path: judoka.photoPath,
    created_by: judoka.createdBy,
    created_workstation: judoka.createdWorkstation ?? 'web',
    sync_status: judoka.syncStatus ?? 'synced',
    version: judoka.version ?? 1
  }
}

export function profileToUserAccount(row: ProfileRow): UserAccount {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? undefined,
    active: row.active,
    createdAt: row.created_at
  }
}

export function mergeSettings(raw: Partial<AppSettings> | null): AppSettings {
  const defaults = createDefaultSettings()
  if (!raw) return defaults
  return {
    event: { ...defaults.event, ...raw.event },
    print: { ...defaults.print, ...raw.print },
    ui: { ...defaults.ui, ...raw.ui },
    network: { ...defaults.network, ...raw.network },
    updatedAt: raw.updatedAt ?? defaults.updatedAt
  }
}

export function templateFromRow(row: { id: string; name: string; is_default: boolean; template: BadgeTemplate; updated_at: string }): BadgeTemplate {
  const t = row.template
  return {
    ...t,
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    updatedAt: row.updated_at
  }
}

export function logRowToEntry(row: {
  id: string
  level: string
  action: string
  message: string
  actor: string | null
  workstation: string | null
  created_at: string
}): SystemLogEntry {
  return {
    id: row.id,
    level: row.level as SystemLogEntry['level'],
    action: row.action,
    message: row.message,
    actor: row.actor ?? undefined,
    workstation: row.workstation ?? undefined,
    createdAt: row.created_at
  }
}
