import { useEffect, useState } from 'react'
import { ImagePlus, Save, Trash2 } from 'lucide-react'
import type { BadgeSizeMm, BadgeTemplate } from '@shared/types/badge'
import { buildBadgeLayout } from '@shared/types/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import { BadgeLivePreview } from '@/components/BadgeLivePreview'

interface Props {
  onBack?: () => void
  embedded?: boolean
}

type FormatKey = '' | 'A6' | 'card' | 'custom'

const FORMAT_PRESETS: Record<Exclude<FormatKey, '' | 'custom'>, BadgeSizeMm & { label: string }> = {
  A6: { widthMm: 105, heightMm: 148, label: 'A6 (105 × 148 mm)' },
  card: { widthMm: 85, heightMm: 55, label: '85 × 55 mm' }
}

function detectFormat(size: BadgeSizeMm): FormatKey {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.2
  if (near(size.widthMm, 105) && near(size.heightMm, 148)) return 'A6'
  if (near(size.widthMm, 85) && near(size.heightMm, 55)) return 'card'
  if (size.widthMm > 0 && size.heightMm > 0) return 'custom'
  return ''
}

/**
 * Designer de badge — format, couleurs, images et aperçu live.
 */
export function BadgeDesignerPage({ onBack, embedded = false }: Props) {
  const [template, setTemplate] = useState<BadgeTemplate | null>(null)
  const [formatKey, setFormatKey] = useState<FormatKey>('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewBg, setPreviewBg] = useState<string | null>(null)
  const [previewLogo, setPreviewLogo] = useState<string | null>(null)

  function applyTemplate(next: BadgeTemplate | null): void {
    setTemplate(next)
    setFormatKey(next ? detectFormat(next.size) : '')
  }

  async function reload(): Promise<void> {
    const res = await window.judovac.listBadgeTemplates()
    if (!res.ok) {
      setError(res.error)
      return
    }
    const active =
      res.data.items.find((t) => t.id === res.data.activeId) ?? res.data.items[0] ?? null
    applyTemplate(active)
  }

  useEffect(() => {
    void reload()
  }, [])

  function applySize(size: BadgeSizeMm): void {
    if (!template) return
    setTemplate({
      ...template,
      size,
      layout: buildBadgeLayout(size)
    })
  }

  function setFormat(next: FormatKey): void {
    if (!template) return
    setFormatKey(next)
    if (next === 'A6' || next === 'card') {
      const preset = FORMAT_PRESETS[next]
      applySize({ widthMm: preset.widthMm, heightMm: preset.heightMm })
    } else if (next === '') {
      setTemplate({
        ...template,
        size: { widthMm: 0, heightMm: 0 }
      })
    }
  }

  async function save(): Promise<void> {
    if (!template) return
    if (!formatKey || template.size.widthMm <= 0 || template.size.heightMm <= 0) {
      setError('Définissez d’abord le format du badge.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await window.judovac.setBadgeTemplate(template)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    applyTemplate(res.data)
    await reload()
    setMessage('Badge enregistré — utilisé pour PDF et impression.')
  }

  async function clearLogo(): Promise<void> {
    if (!template) return
    setBusy(true)
    setError(null)
    const next = { ...template, logoPath: null }
    applyTemplate(next)
    setPreviewLogo(null)
    setBusy(false)
    setMessage('Logo effacé — logo JudoVACapp par défaut dans l’aperçu. Enregistrez pour confirmer.')
  }

  async function clearBackground(): Promise<void> {
    if (!template) return
    setBusy(true)
    setError(null)
    const next = { ...template, backgroundPath: null }
    applyTemplate(next)
    setPreviewBg(null)
    setBusy(false)
    setMessage('Fond effacé dans l’aperçu. Enregistrez pour confirmer.')
  }

  async function importAsset(kind: 'background' | 'logo'): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await window.judovac.importBadgeAsset(kind)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    if (res.data.template) {
      applyTemplate(res.data.template)
      if (res.data.dataUrl) {
        if (kind === 'background') setPreviewBg(res.data.dataUrl)
        else setPreviewLogo(res.data.dataUrl)
      }
      setMessage(
        kind === 'background'
          ? 'Fond chargé dans l’aperçu — cliquez sur Enregistrer le badge pour le conserver.'
          : 'Logo chargé dans l’aperçu — cliquez sur Enregistrer le badge pour le conserver.'
      )
    }
  }

  if (!template) {
    return (
      <AppShell embedded={embedded} title="Designer de badge">
        <p className="text-sm text-muted-foreground">{error ?? 'Chargement…'}</p>
      </AppShell>
    )
  }

  const formatDefined =
    formatKey !== '' && template.size.widthMm > 0 && template.size.heightMm > 0

  return (
    <AppShell
      embedded={embedded}
      title="Designer de badge"
      subtitle="Format, couleurs et images — utilisé pour PDF et impression"
      actions={
        !embedded && onBack ? (
          <Button variant="outline" onClick={onBack}>
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border bg-white/75 p-5">
          <h2 className="font-semibold text-judo-navy">Général</h2>
          <div className="space-y-2">
            <Label htmlFor="badge-format">Format prédéfini</Label>
            <select
              id="badge-format"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={formatKey}
              onChange={(e) => setFormat(e.target.value as FormatKey)}
            >
              <option value="">Choisir un format…</option>
              <option value="A6">{FORMAT_PRESETS.A6.label}</option>
              <option value="card">{FORMAT_PRESETS.card.label}</option>
              <option value="custom">Personnalisé</option>
            </select>
          </div>
          {(formatKey === 'custom' || formatKey === 'A6' || formatKey === 'card') && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Largeur (mm)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={template.size.widthMm || ''}
                  disabled={formatKey === 'A6' || formatKey === 'card'}
                  onChange={(e) => {
                    setFormatKey('custom')
                    applySize({
                      widthMm: Number(e.target.value),
                      heightMm: template.size.heightMm
                    })
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Hauteur (mm)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={template.size.heightMm || ''}
                  disabled={formatKey === 'A6' || formatKey === 'card'}
                  onChange={(e) => {
                    setFormatKey('custom')
                    applySize({
                      widthMm: template.size.widthMm,
                      heightMm: Number(e.target.value)
                    })
                  }}
                />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>DPI impression</Label>
            <Input
              type="number"
              min={300}
              value={template.dpi}
              onChange={(e) =>
                setTemplate({ ...template, dpi: Math.max(300, Number(e.target.value)) })
              }
            />
          </div>
        </section>

        <section className="space-y-4 rounded-xl border bg-white/75 p-5">
          <h2 className="font-semibold text-judo-navy">Images</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Fond</p>
              <p className="truncate font-mono text-xs">{template.backgroundPath ?? '—'}</p>
              <div className="mt-2 flex flex-wrap justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void importAsset('background')}
                >
                  <ImagePlus className="h-4 w-4" />
                  Importer background
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !template.backgroundPath}
                  onClick={() => void clearBackground()}
                >
                  <Trash2 className="h-4 w-4" />
                  Effacer BG
                </Button>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Logo</p>
              <p className="truncate font-mono text-xs">
                {template.logoPath ?? 'Logo JudoVACapp par défaut'}
              </p>
              <div className="mt-2 flex flex-wrap justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void importAsset('logo')}
                >
                  <ImagePlus className="h-4 w-4" />
                  Importer logo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !template.logoPath}
                  onClick={() => void clearLogo()}
                >
                  <Trash2 className="h-4 w-4" />
                  Effacer
                </Button>
              </div>
            </div>
          </div>
        </section>

        {formatDefined ? (
          <section className="rounded-xl border bg-white/75 p-5 lg:col-span-2">
            <BadgeLivePreview
              template={template}
              previewBackgroundUrl={previewBg}
              previewLogoUrl={previewLogo}
            />
          </section>
        ) : (
          <section className="rounded-xl border border-dashed bg-white/40 p-5 lg:col-span-2">
            <p className="text-sm text-muted-foreground">
              L’aperçu live s’affichera après avoir défini le format du badge.
            </p>
          </section>
        )}

        <section className="space-y-4 rounded-xl border bg-white/75 p-5">
          <h2 className="font-semibold text-judo-navy">Couleurs</h2>
          {(
            [
              ['primary', 'Primaire'],
              ['secondary', 'Secondaire (poids)'],
              ['text', 'Texte'],
              ['band', 'Bandeau n° badge'],
              ['bandText', 'Texte n° badge']
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center gap-3">
              <Label className="w-36 shrink-0 text-sm">{label}</Label>
              <input
                type="color"
                value={template.colors[key]}
                onChange={(e) =>
                  setTemplate({
                    ...template,
                    colors: { ...template.colors, [key]: e.target.value }
                  })
                }
              />
              <Input
                className="font-mono text-xs"
                value={template.colors[key]}
                onChange={(e) =>
                  setTemplate({
                    ...template,
                    colors: { ...template.colors, [key]: e.target.value }
                  })
                }
              />
            </div>
          ))}
        </section>

        {error && <p className="text-sm text-destructive lg:col-span-2">{error}</p>}
        {message && <p className="text-sm text-emerald-700 lg:col-span-2">{message}</p>}

        <div className="lg:col-span-2">
          <Button variant="accent" size="lg" disabled={busy} onClick={() => void save()}>
            <Save className="h-4 w-4" />
            {busy ? 'Enregistrement…' : 'Enregistrer le badge'}
          </Button>
        </div>
      </div>
    </AppShell>
  )
}
