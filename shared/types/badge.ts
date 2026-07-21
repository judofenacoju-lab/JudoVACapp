/** Dimensions badge en millimètres (défaut A6 portrait). */
export interface BadgeSizeMm {
  widthMm: number
  heightMm: number
}

export interface BadgePosition {
  x: number
  y: number
  width: number
  height: number
}

export interface BadgeTextStyle {
  x: number
  y: number
  fontSize: number
  color: string
  fontFamily: string
  align: 'left' | 'center' | 'right'
  maxWidth?: number
}

/**
 * Modèle de badge sérialisable JSON — partagé serveur → clients via Socket.IO.
 */
export interface BadgeTemplate {
  id: string
  name: string
  isDefault: boolean
  layoutVersion?: number
  size: BadgeSizeMm
  dpi: number
  backgroundPath: string | null
  logoPath: string | null
  colors: {
    primary: string
    secondary: string
    text: string
    /** Couleur du bandeau plein largeur (numéro de badge) */
    band: string
    /** Couleur du texte du numéro de badge */
    bandText: string
  }
  layout: {
    photo: BadgePosition
    qrCode: BadgePosition
    logo: BadgePosition
    /** Hauteur du bandeau numéro (unités canvas) */
    displayIdBand: BadgePosition
    fields: {
      fullName: BadgeTextStyle
      category: BadgeTextStyle
      weight: BadgeTextStyle
      sex: BadgeTextStyle
      displayId: BadgeTextStyle
    }
  }
  showSignature: boolean
  updatedAt: string
}

export const BADGE_LAYOUT_VERSION = 6

function badgeDesignCanvasFromSize(size: BadgeSizeMm): { width: number; height: number } {
  const scale = 2.5
  return { width: size.widthMm * scale, height: size.heightMm * scale }
}

export function isCardBadgeSize(size: BadgeSizeMm): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5
  return near(size.widthMm, 85) && near(size.heightMm, 55)
}

function mkText(
  x: number,
  y: number,
  fs: number,
  align: BadgeTextStyle['align'],
  maxWidth: number,
  color: string,
  bold = true
): BadgeTextStyle {
  return {
    x,
    y,
    fontSize: fs,
    color,
    fontFamily: bold ? 'Helvetica-Bold' : 'Helvetica',
    align,
    maxWidth
  }
}

/** Format carte 85×55 — photo à droite, infos à gauche. */
function buildCardLayout(W: number, H: number): BadgeTemplate['layout'] {
  const margin = 6
  const bandH = 11
  const logoSize = 20
  const qrSize = 32
  const photoW = 58
  const photoH = H - margin - bandH - 2
  const photoX = W - margin - photoW
  const textX = margin
  const textW = photoX - margin - 5
  const textY = margin + logoSize + 3
  /** Interligne +50 % vs v5 (10 → 15) */
  const lineH = 15

  return {
    logo: { x: margin, y: margin, width: logoSize, height: logoSize },
    photo: { x: photoX, y: margin, width: photoW, height: photoH },
    qrCode: { x: W - margin - qrSize, y: H - bandH - qrSize - 2, width: qrSize, height: qrSize },
    displayIdBand: { x: 0, y: H - bandH, width: W, height: bandH },
    fields: {
      fullName: mkText(textX, textY, 8, 'center', textW, '#0B1F3A'),
      category: mkText(textX, textY + lineH, 7, 'center', textW, '#0B1F3A'),
      weight: mkText(textX, textY + lineH * 2, 7, 'center', textW, '#FFFFFF'),
      sex: mkText(textX, textY + lineH * 3, 7, 'center', textW, '#0B1F3A', false),
      displayId: mkText(0, H - bandH + 2, 6, 'center', W, '#FFFFFF')
    }
  }
}

/** Format portrait (A6, etc.) — éléments centrés. */
function buildPortraitLayout(W: number, H: number): BadgeTemplate['layout'] {
  const margin = 16
  const contentW = W - margin * 2
  const bandH = 16
  const logoSize = 52
  const logoY = 10
  const photoW = Math.min(96, W * 0.36)
  const photoH = photoW * 1.25
  const photoY = logoY + logoSize + 10
  const qrSize = 68
  const qrX = W - margin - qrSize
  const textY = photoY + photoH + 14
  /** Interligne +50 % vs v5 (14 → 21) */
  const lineH = 21

  return {
    logo: { x: (W - logoSize) / 2, y: logoY, width: logoSize, height: logoSize },
    photo: { x: (W - photoW) / 2, y: photoY, width: photoW, height: photoH },
    qrCode: { x: qrX, y: H - bandH - qrSize - 6, width: qrSize, height: qrSize },
    displayIdBand: { x: 0, y: H - bandH, width: W, height: bandH },
    fields: {
      fullName: mkText(margin, textY, 16, 'center', contentW, '#0B1F3A'),
      category: mkText(margin, textY + lineH, 12, 'center', contentW, '#0B1F3A'),
      weight: mkText(margin, textY + lineH * 2, 12, 'center', contentW, '#FFFFFF'),
      sex: mkText(margin, textY + lineH * 3, 12, 'center', contentW, '#0B1F3A', false),
      displayId: mkText(0, H - bandH + 4, 9, 'center', W, '#FFFFFF')
    }
  }
}

export function buildBadgeLayout(size: BadgeSizeMm): BadgeTemplate['layout'] {
  const { width: W, height: H } = badgeDesignCanvasFromSize(size)
  if (isCardBadgeSize(size)) return buildCardLayout(W, H)
  return buildPortraitLayout(W, H)
}

export function defaultBadgeColors(): BadgeTemplate['colors'] {
  return {
    primary: '#0B1F3A',
    secondary: '#C8102E',
    text: '#0B1F3A',
    band: '#0B1F3A',
    bandText: '#FFFFFF'
  }
}

export function createDefaultBadgeTemplate(): BadgeTemplate {
  const size = { widthMm: 105, heightMm: 148 }
  return {
    id: 'default',
    name: 'Badge officiel',
    isDefault: true,
    layoutVersion: BADGE_LAYOUT_VERSION,
    size,
    dpi: 300,
    backgroundPath: null,
    logoPath: null,
    colors: defaultBadgeColors(),
    layout: buildBadgeLayout(size),
    showSignature: false,
    updatedAt: new Date().toISOString()
  }
}
