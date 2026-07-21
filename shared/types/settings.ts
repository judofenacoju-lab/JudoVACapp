/**
 * Paramètres applicatifs persistés (table settings + cache fichier).
 */
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
    updatedAt: new Date().toISOString()
  }
}
