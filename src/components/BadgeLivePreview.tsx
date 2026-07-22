import { useEffect, useState } from 'react'
import type { BadgeTemplate } from '@shared/types/badge'
import { badgeDesignCanvas } from '@shared/utils/badge-canvas'
import brandLogo from '@/assets/brand-logo.png'

const SAMPLE = {
  fullName: 'Kitete Orient',
  category: 'Senior',
  weight: '73 kg',
  sex: 'M',
  displayId: 'JV-2026-00001'
}

const PREVIEW_MAX_HEIGHT = 420

export function BadgeLivePreview({
  template,
  previewBackgroundUrl,
  previewLogoUrl
}: {
  template: BadgeTemplate
  /** Data URL immédiate après import (avant lecture Storage). */
  previewBackgroundUrl?: string | null
  previewLogoUrl?: string | null
}) {
  const { width: designW, height: designH } = badgeDesignCanvas(
    template.size.widthMm > 0 && template.size.heightMm > 0
      ? template.size
      : { widthMm: 105, heightMm: 148 }
  )
  const scale = Math.min(1.15, PREVIEW_MAX_HEIGHT / Math.max(designH, 1))
  const w = designW * scale
  const h = designH * scale

  const photo = template.layout.photo
  const qr = template.layout.qrCode
  const logo = template.layout.logo
  const band = template.layout.displayIdBand
  const fields = template.layout.fields
  const primary = template.colors.primary
  const weightBg = template.colors.secondary
  const bandBg = template.colors.band
  const bandTextColor = template.colors.bandText

  const [logoSrc, setLogoSrc] = useState<string>(brandLogo)
  const [bgSrc, setBgSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (previewLogoUrl) {
      setLogoSrc(previewLogoUrl)
    } else if (!template.logoPath) {
      setLogoSrc(brandLogo)
    } else {
      void window.judovac.readPhotoDataUrl(template.logoPath).then((res) => {
        if (cancelled) return
        setLogoSrc(res.ok && res.data.dataUrl ? res.data.dataUrl : brandLogo)
      })
    }
    if (previewBackgroundUrl) {
      setBgSrc(previewBackgroundUrl)
    } else if (!template.backgroundPath) {
      setBgSrc(null)
    } else {
      void window.judovac.readPhotoDataUrl(template.backgroundPath).then((res) => {
        if (cancelled) return
        setBgSrc(res.ok && res.data.dataUrl ? res.data.dataUrl : null)
      })
    }
    return () => {
      cancelled = true
    }
  }, [template.logoPath, template.backgroundPath, previewLogoUrl, previewBackgroundUrl])

  const logoSide = Math.max(logo.width, logo.height) * scale

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Aperçu Badge
      </p>
      <div
        className="relative overflow-hidden rounded-md border shadow-sm"
        style={{
          width: w,
          height: h,
          backgroundColor: '#fff',
          backgroundImage: bgSrc ? `url(${bgSrc})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        <div
          className="absolute overflow-hidden rounded-full bg-white"
          style={{
            left: logo.x * scale + (logo.width * scale - logoSide) / 2,
            top: logo.y * scale + (logo.height * scale - logoSide) / 2,
            width: logoSide,
            height: logoSide
          }}
        >
          <img src={logoSrc} alt="Logo" className="h-full w-full rounded-full object-cover" />
        </div>

        <div
          className="absolute overflow-hidden bg-[#e8eef4]"
          style={{
            left: photo.x * scale,
            top: photo.y * scale,
            width: photo.width * scale,
            height: photo.height * scale,
            border: `2px solid ${primary}`,
            borderRadius: Math.min(photo.width, photo.height) * scale * 0.12
          }}
        >
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
            Photo
          </div>
        </div>

        <div
          className="absolute grid place-items-center bg-white"
          style={{
            left: qr.x * scale,
            top: qr.y * scale,
            width: qr.width * scale,
            height: qr.height * scale,
            border: `2px solid ${primary}`,
            backgroundImage: 'repeating-conic-gradient(#0f172a 0% 25%, #fff 0% 50%)',
            backgroundSize: `${5 * scale}px ${5 * scale}px`,
            backgroundPosition: 'center'
          }}
          title="QR Code"
        />

        <div
          className="absolute"
          style={{
            left: band.x * scale,
            top: band.y * scale,
            width: band.width * scale,
            height: band.height * scale,
            backgroundColor: bandBg
          }}
        />

        <PreviewText
          text={SAMPLE.fullName}
          style={{ ...fields.fullName, color: template.colors.text }}
          scale={scale}
          bold
        />
        <PreviewText text={SAMPLE.category} style={fields.category} scale={scale} />
        <PreviewText
          text={SAMPLE.weight}
          style={{ ...fields.weight, color: '#FFFFFF' }}
          scale={scale}
          backgroundColor={weightBg}
        />
        <PreviewText text={SAMPLE.sex} style={fields.sex} scale={scale} />
        <PreviewText
          text={SAMPLE.displayId}
          style={{ ...fields.displayId, color: bandTextColor }}
          scale={scale}
          fullWidthBand
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Canvas {template.size.widthMm}×{template.size.heightMm} mm · {template.dpi} DPI
      </p>
    </div>
  )
}

function PreviewText({
  text,
  style,
  scale,
  bold,
  backgroundColor,
  fullWidthBand
}: {
  text: string
  style: {
    x: number
    y: number
    fontSize: number
    color: string
    align: 'left' | 'center' | 'right'
    maxWidth?: number
  }
  scale: number
  bold?: boolean
  backgroundColor?: string
  fullWidthBand?: boolean
}) {
  const padX = 4 * scale
  const padY = 2 * scale
  const fontSize = style.fontSize * scale
  const maxW = (style.maxWidth ?? 160) * scale

  if (fullWidthBand) {
    return (
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: style.x * scale,
          top: style.y * scale,
          width: maxW,
          fontSize,
          color: style.color,
          fontWeight: bold ? 700 : 500,
          lineHeight: 1.1,
          textAlign: 'center'
        }}
      >
        {text}
      </div>
    )
  }

  if (backgroundColor) {
    return (
      <div
        className="absolute flex justify-center"
        style={{
          left: style.x * scale,
          top: style.y * scale,
          width: maxW
        }}
      >
        <span
          className="inline-block whitespace-nowrap"
          style={{
            fontSize,
            color: style.color,
            fontWeight: bold ? 700 : 500,
            lineHeight: 1.1,
            backgroundColor,
            padding: `${padY}px ${padX}px`,
            borderRadius: 2 * scale
          }}
        >
          {text}
        </span>
      </div>
    )
  }

  return (
    <div
      className="absolute flex overflow-hidden"
      style={{
        left: style.x * scale,
        top: style.y * scale,
        width: maxW,
        justifyContent:
          style.align === 'center' ? 'center' : style.align === 'right' ? 'flex-end' : 'flex-start'
      }}
    >
      <span
        className="whitespace-nowrap"
        style={{
          fontSize,
          color: style.color,
          fontWeight: bold ? 700 : 500,
          lineHeight: 1.1
        }}
      >
        {text}
      </span>
    </div>
  )
}
