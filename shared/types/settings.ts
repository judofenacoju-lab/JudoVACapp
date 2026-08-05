/**
 * Paramètres applicatifs persistés (table settings + cache fichier).
 */

/** Tranche d'âge → catégorie judoka. */
export interface CategoryAgeRange {
  name: string
  minAge: number
  maxAge: number
}

/** Catégorie / libellé de poids (Tirage + Triage), ex. −20 kg = 18–20. */
export interface WeightClassRange {
  id: string
  label: string
  minKg: number
  maxKg: number
}

export function createDefaultCategoryAgeRanges(): CategoryAgeRange[] {
  return [
    { name: 'Eveil', minAge: 3, maxAge: 5 },
    { name: 'Pré-poussin', minAge: 6, maxAge: 7 },
    { name: 'Poussin', minAge: 8, maxAge: 9 },
    { name: 'Benjamin', minAge: 10, maxAge: 11 },
    { name: 'Minim', minAge: 12, maxAge: 13 },
    { name: 'Cadet', minAge: 14, maxAge: 17 },
    { name: 'Junior', minAge: 18, maxAge: 20 },
    { name: 'Sénior', minAge: 21, maxAge: 99 }
  ]
}

export interface AppSettings {
  event: {
    name: string
    type: 'competition' | 'exam' | 'stage' | 'other'
    location: string
    startDate: string
    endDate: string
    organizer: string
  }
  print: {
    defaultPrinter: string
    copies: number
    silent: boolean
    preferPdfPreview: boolean
  }
  ui: {
    primaryColor: string
    accentColor: string
  }
  network: {
    serverPort: number
  }
  /** Tranches d'âge pour la catégorisation automatique. */
  categories: CategoryAgeRange[]
  /** Clubs proposés à tous les utilisateurs lors de l'enregistrement judoka. */
  clubs: string[]
  /** Libellés de poids partagés (Tirage / Triage). */
  weightClasses: WeightClassRange[]
  updatedAt: string
}

export function createDefaultSettings(): AppSettings {
  return {
    event: {
      name: 'Événement judo',
      type: 'competition',
      location: '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      organizer: ''
    },
    print: {
      defaultPrinter: '',
      copies: 1,
      silent: false,
      preferPdfPreview: true
    },
    ui: {
      primaryColor: '#0B1F3A',
      accentColor: '#C8102E'
    },
    network: {
      serverPort: 3847
    },
    categories: createDefaultCategoryAgeRanges(),
    clubs: [],
    weightClasses: [],
    updatedAt: new Date().toISOString()
  }
}
