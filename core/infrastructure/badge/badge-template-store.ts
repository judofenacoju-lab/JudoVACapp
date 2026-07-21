import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import type { BadgeTemplate } from '@shared/types/badge'
import {
  BADGE_LAYOUT_VERSION,
  buildBadgeLayout,
  createDefaultBadgeTemplate,
  defaultBadgeColors
} from '@shared/types/badge'

interface Catalog {
  activeId: string
  templates: BadgeTemplate[]
}

/**
 * Catalogue multi-modèles de badges.
 * Migration auto depuis l'ancien fichier unique badge-template.json.
 */
export class BadgeTemplateStore {
  private readonly catalogPath: string
  private readonly legacyPath: string
  private catalog: Catalog

  constructor(basePath?: string) {
    const dir = join(basePath ?? app.getPath('userData'), 'assets')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.catalogPath = join(dir, 'badge-templates.json')
    this.legacyPath = join(dir, 'badge-template.json')
    this.catalog = this.load()
  }

  list(): BadgeTemplate[] {
    return [...this.catalog.templates]
  }

  getActive(): BadgeTemplate {
    return (
      this.catalog.templates.find((t) => t.id === this.catalog.activeId) ??
      this.catalog.templates[0] ??
      createDefaultBadgeTemplate()
    )
  }

  get(): BadgeTemplate {
    return this.getActive()
  }

  setActive(id: string): BadgeTemplate {
    const found = this.catalog.templates.find((t) => t.id === id)
    if (!found) throw new Error(`Modèle introuvable: ${id}`)
    this.catalog.activeId = id
    this.catalog.templates = this.catalog.templates.map((t) => ({
      ...t,
      isDefault: t.id === id
    }))
    this.persist()
    return found
  }

  set(template: BadgeTemplate): BadgeTemplate {
    const updated = {
      ...template,
      layoutVersion: template.layoutVersion ?? BADGE_LAYOUT_VERSION,
      updatedAt: new Date().toISOString()
    }
    const idx = this.catalog.templates.findIndex((t) => t.id === updated.id)
    if (idx >= 0) {
      this.catalog.templates[idx] = updated
    } else {
      this.catalog.templates.push(updated)
      this.catalog.activeId = updated.id
    }
    if (updated.isDefault) {
      this.catalog.activeId = updated.id
      this.catalog.templates = this.catalog.templates.map((t) => ({
        ...t,
        isDefault: t.id === updated.id
      }))
    }
    this.persist()
    return updated
  }

  create(name?: string): BadgeTemplate {
    const base = this.getActive()
    const template: BadgeTemplate = {
      ...structuredClone(base),
      id: randomUUID(),
      name: name?.trim() || `Modèle ${this.catalog.templates.length + 1}`,
      isDefault: false,
      layoutVersion: BADGE_LAYOUT_VERSION,
      updatedAt: new Date().toISOString()
    }
    this.catalog.templates.push(template)
    this.catalog.activeId = template.id
    this.catalog.templates = this.catalog.templates.map((t) => ({
      ...t,
      isDefault: t.id === template.id
    }))
    this.persist()
    return template
  }

  delete(id: string): BadgeTemplate {
    if (this.catalog.templates.length <= 1) {
      throw new Error('Impossible de supprimer le dernier modèle')
    }
    this.catalog.templates = this.catalog.templates.filter((t) => t.id !== id)
    if (this.catalog.activeId === id) {
      this.catalog.activeId = this.catalog.templates[0]!.id
    }
    this.catalog.templates = this.catalog.templates.map((t) => ({
      ...t,
      isDefault: t.id === this.catalog.activeId
    }))
    this.persist()
    return this.getActive()
  }

  private persist(): void {
    writeFileSync(this.catalogPath, JSON.stringify(this.catalog, null, 2), 'utf-8')
  }

  private migrateLayout(templates: BadgeTemplate[]): BadgeTemplate[] {
    let changed = false
    const next = templates.map((t) => {
      const colors = {
        ...defaultBadgeColors(),
        ...t.colors,
        band: t.colors.band ?? defaultBadgeColors().band,
        bandText: (t.colors as { bandText?: string }).bandText ?? defaultBadgeColors().bandText
      }
      const needsLayout =
        (t.layoutVersion ?? 1) < BADGE_LAYOUT_VERSION ||
        !t.layout.displayIdBand ||
        !(t.colors as { bandText?: string }).bandText

      if (!needsLayout) {
        if (
          colors.band !== t.colors.band ||
          (t.colors as { bandText?: string }).bandText !== colors.bandText
        ) {
          changed = true
          return { ...t, colors, updatedAt: new Date().toISOString() }
        }
        return t
      }

      changed = true
      return {
        ...t,
        layout: buildBadgeLayout(t.size),
        layoutVersion: BADGE_LAYOUT_VERSION,
        colors,
        showSignature: false,
        updatedAt: new Date().toISOString()
      }
    })
    if (changed) {
      writeFileSync(
        this.catalogPath,
        JSON.stringify({ activeId: this.catalog.activeId, templates: next }, null, 2),
        'utf-8'
      )
    }
    return next
  }

  private load(): Catalog {
    if (existsSync(this.catalogPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.catalogPath, 'utf-8')) as Catalog
        if (Array.isArray(raw.templates) && raw.templates.length > 0) {
          const catalog: Catalog = {
            activeId: raw.activeId || raw.templates[0]!.id,
            templates: raw.templates
          }
          this.catalog = catalog
          catalog.templates = this.migrateLayout(catalog.templates)
          this.catalog = catalog
          return catalog
        }
      } catch {
        /* recreate */
      }
    }

    if (existsSync(this.legacyPath)) {
      try {
        const legacy = JSON.parse(readFileSync(this.legacyPath, 'utf-8')) as BadgeTemplate
        const catalog: Catalog = {
          activeId: legacy.id || 'default',
          templates: [{ ...legacy, isDefault: true }]
        }
        this.catalog = catalog
        catalog.templates = this.migrateLayout(catalog.templates)
        this.catalog = catalog
        return catalog
      } catch {
        /* fallthrough */
      }
    }

    const def = createDefaultBadgeTemplate()
    const catalog: Catalog = { activeId: def.id, templates: [def] }
    writeFileSync(this.catalogPath, JSON.stringify(catalog, null, 2), 'utf-8')
    return catalog
  }
}
