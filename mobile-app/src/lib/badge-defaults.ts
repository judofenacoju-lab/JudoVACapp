/** Modèle badge par défaut (A6) — autonome pour l’app mobile. */

export type BadgeTemplate = {
  id: string
  name: string
  isDefault: boolean
  size: { widthMm: number; heightMm: number }
  dpi: number
  backgroundPath: string | null
  logoPath: string | null
  colors: {
    primary: string
    secondary: string
    text: string
    band: string
    bandText: string
  }
  layout: {
    photo: { x: number; y: number; width: number; height: number }
    qrCode: { x: number; y: number; width: number; height: number }
    logo: { x: number; y: number; width: number; height: number }
    displayIdBand: { x: number; y: number; width: number; height: number }
    fields: Record<
      string,
      {
        x: number
        y: number
        fontSize: number
        color: string
        fontFamily: string
        align: 'left' | 'center' | 'right'
        maxWidth?: number
      }
    >
  }
  showSignature: boolean
  updatedAt: string
}

const DESIGN_SCALE = 2.5

export function createDefaultBadgeTemplate(): BadgeTemplate {
  const W = 105 * DESIGN_SCALE
  const H = 148 * DESIGN_SCALE
  const margin = 12
  const logoSize = 42
  const photoW = 95
  const photoH = 115
  const bandH = 22
  const qrSize = 48
  return {
    id: 'default',
    name: 'Badge A6',
    isDefault: true,
    size: { widthMm: 105, heightMm: 148 },
    dpi: 300,
    backgroundPath: null,
    logoPath: null,
    colors: {
      primary: '#0B1F3A',
      secondary: '#C8102E',
      text: '#0B1F3A',
      band: '#0B1F3A',
      bandText: '#FFFFFF'
    },
    layout: {
      logo: { x: (W - logoSize) / 2, y: margin, width: logoSize, height: logoSize },
      photo: {
        x: (W - photoW) / 2,
        y: margin + logoSize + 8,
        width: photoW,
        height: photoH
      },
      qrCode: {
        x: W - margin - qrSize,
        y: H - bandH - qrSize - 6,
        width: qrSize,
        height: qrSize
      },
      displayIdBand: { x: 0, y: H - bandH, width: W, height: bandH },
      fields: {
        fullName: {
          x: margin,
          y: margin + logoSize + 8 + photoH + 10,
          fontSize: 16,
          color: '#0B1F3A',
          fontFamily: 'Helvetica-Bold',
          align: 'center',
          maxWidth: W - margin * 2
        },
        category: {
          x: margin,
          y: margin + logoSize + 8 + photoH + 32,
          fontSize: 12,
          color: '#0B1F3A',
          fontFamily: 'Helvetica',
          align: 'center',
          maxWidth: W - margin * 2
        },
        weight: {
          x: margin,
          y: margin + logoSize + 8 + photoH + 50,
          fontSize: 12,
          color: '#FFFFFF',
          fontFamily: 'Helvetica-Bold',
          align: 'center',
          maxWidth: W - margin * 2
        },
        sex: {
          x: margin,
          y: margin + logoSize + 8 + photoH + 70,
          fontSize: 12,
          color: '#0B1F3A',
          fontFamily: 'Helvetica',
          align: 'center',
          maxWidth: W - margin * 2
        },
        displayId: {
          x: 0,
          y: H - bandH + 4,
          fontSize: 14,
          color: '#FFFFFF',
          fontFamily: 'Helvetica',
          align: 'center',
          maxWidth: W
        }
      }
    },
    showSignature: false,
    updatedAt: new Date().toISOString()
  }
}
