import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ImagePlus, Search, X } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName, resolveJudokaCategory } from '@shared/utils/judoka'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  onClose: () => void
  onUpdated?: () => void
}

function hasPhoto(path: string | null | undefined): boolean {
  return Boolean(path && path.trim())
}

/**
 * Modal : judokas sans photo — prise / import photo rapide.
 */
export function UnphotographedJudokasModal({ onClose, onUpdated }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Judoka[]>([])
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const targetIdRef = useRef<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const pageSize = 1000
      const all: Judoka[] = []
      let offset = 0
      for (;;) {
        const res = await window.judovac.listJudokas({ limit: pageSize, offset })
        if (!res.ok) {
          setError(res.error)
          setItems([])
          return
        }
        all.push(...res.data.items)
        if (res.data.items.length < pageSize) break
        offset += pageSize
      }
      const withoutPhoto = all
        .filter((j) => !hasPhoto(j.photoPath))
        .sort((a, b) => formatJudokaFullName(a).localeCompare(formatJudokaFullName(b), 'fr'))
      setItems(withoutPhoto)
      setRowError({})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((j) => {
      const hay = [
        j.lastName,
        j.middleName,
        j.firstName,
        formatJudokaFullName(j),
        j.displayId,
        j.club
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [items, query])

  function openCamera(id: string): void {
    targetIdRef.current = id
    cameraInputRef.current?.click()
  }

  function openImport(id: string): void {
    targetIdRef.current = id
    fileInputRef.current?.click()
  }

  async function applyFile(file: File | undefined): Promise<void> {
    const id = targetIdRef.current
    targetIdRef.current = null
    if (!file || !id) return

    const judoka = items.find((j) => j.id === id)
    if (!judoka) return

    setBusyId(id)
    setRowError((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Lecture du fichier impossible'))
        reader.readAsDataURL(file)
      })

      const up = await window.judovac.savePhotoDataUrl(dataUrl)
      if (!up.ok) {
        setRowError((prev) => ({ ...prev, [id]: up.error }))
        return
      }

      const res = await window.judovac.updateJudoka(id, {
        ...judoka,
        photoPath: up.data.path
      })
      if (!res.ok) {
        setRowError((prev) => ({ ...prev, [id]: res.error }))
        return
      }

      setItems((prev) => prev.filter((x) => x.id !== id))
      onUpdated?.()
    } catch (e) {
      setRowError((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : 'Photo impossible'
      }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fermer"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unphoto-title"
        className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 id="unphoto-title" className="font-display text-lg font-semibold text-judo-navy">
              Judokas non photographiés
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {loading
                ? 'Chargement…'
                : query.trim()
                  ? `${filtered.length} résultat(s) sur ${items.length} sans photo`
                  : `${items.length} judoka(s) sans photo`}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="border-b px-3 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Rechercher par nom, prénom, ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3">
          {error && <p className="px-2 text-sm text-destructive">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="px-2 text-sm text-emerald-700">Tous vos judokas ont une photo.</p>
          )}
          {!loading && !error && items.length > 0 && filtered.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">
              Aucun judoka sans photo ne correspond à « {query.trim()} ».
            </p>
          )}
          <ul className="space-y-2">
            {filtered.map((j) => {
              const category = resolveJudokaCategory(j.birthDate, j.category)
              const busy = busyId === j.id
              return (
                <li key={j.id} className="rounded-lg border bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-judo-navy">{formatJudokaFullName(j)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          j.displayId,
                          j.sex === 'F' ? 'Fille' : 'Garçon',
                          j.club.trim() || null,
                          category || null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Prendre une photo"
                        disabled={busy}
                        onClick={() => openCamera(j.id)}
                      >
                        <Camera className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Charger une photo"
                        disabled={busy}
                        onClick={() => openImport(j.id)}
                      >
                        <ImagePlus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {busy && (
                    <p className="mt-2 text-xs text-muted-foreground">Enregistrement de la photo…</p>
                  )}
                  {rowError[j.id] && (
                    <p className="mt-1 text-xs text-destructive">{rowError[j.id]}</p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void applyFile(file)
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void applyFile(file)
        }}
      />
    </div>
  )
}
