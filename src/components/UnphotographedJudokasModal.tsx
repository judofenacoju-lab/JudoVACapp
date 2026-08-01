import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ImagePlus, Search, SwitchCamera, X } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import { formatJudokaFullName, resolveJudokaCategory } from '@shared/utils/judoka'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  onClose: () => void
  onUpdated?: () => void
}

type FacingMode = 'user' | 'environment'

function hasPhoto(path: string | null | undefined): boolean {
  return Boolean(path && path.trim())
}

function isFrontLabel(label: string): boolean {
  const l = label.toLowerCase()
  return (
    l.includes('front') ||
    l.includes('user') ||
    l.includes('face') ||
    l.includes('avant') ||
    l.includes('selfie')
  )
}

function isBackLabel(label: string): boolean {
  const l = label.toLowerCase()
  return (
    l.includes('back') ||
    l.includes('rear') ||
    l.includes('environment') ||
    l.includes('arrière') ||
    l.includes('arriere') ||
    l.includes('world')
  )
}

async function resolveDeviceId(facing: FacingMode): Promise<string | undefined> {
  if (!navigator.mediaDevices?.enumerateDevices) return undefined
  const devices = await navigator.mediaDevices.enumerateDevices()
  const cams = devices.filter((d) => d.kind === 'videoinput')
  if (cams.length === 0) return undefined

  const match =
    facing === 'user'
      ? cams.find((d) => isFrontLabel(d.label))
      : cams.find((d) => isBackLabel(d.label))

  if (match?.deviceId) return match.deviceId
  if (facing === 'environment' && cams[0]?.deviceId) return cams[0].deviceId
  if (facing === 'user' && cams.length > 1 && cams[1]?.deviceId) return cams[1].deviceId
  if (facing === 'user' && cams[0]?.deviceId) return cams[0].deviceId
  return undefined
}

async function openMediaStream(facing: FacingMode): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia indisponible')
  }

  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { exact: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    },
    {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    }
  ]

  const deviceId = await resolveDeviceId(facing)
  if (deviceId) {
    attempts.unshift({
      audio: false,
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    })
  }

  let lastError: unknown
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastError = err
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  } catch (err) {
    throw lastError ?? err
  }
}

/**
 * Modal : judokas sans photo — caméra live (avant/arrière) ou import.
 */
export function UnphotographedJudokasModal({ onClose, onUpdated }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Judoka[]>([])
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [captureTarget, setCaptureTarget] = useState<Judoka | null>(null)
  const [facing, setFacing] = useState<FacingMode>('environment')
  const [camReady, setCamReady] = useState(false)
  const [camBusy, setCamBusy] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importTargetRef = useRef<string | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await window.judovac.listJudokas({ limit: 1_000_000, offset: 0 })
      if (!res.ok) {
        setError(res.error)
        setItems([])
        return
      }
      const withoutPhoto = res.data.items
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

  useEffect(() => {
    return () => stopCam()
  }, [])

  useEffect(() => {
    if (!camReady || !streamRef.current || !videoRef.current) return
    const video = videoRef.current
    video.srcObject = streamRef.current
    void video.play().catch(() => {
      setCamError("Impossible de démarrer l'aperçu caméra.")
    })
  }, [camReady, facing])

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

  function stopCam(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamReady(false)
  }

  async function startCamera(judoka: Judoka, nextFacing: FacingMode): Promise<void> {
    setCaptureTarget(judoka)
    setCamError(null)
    setCamBusy(true)
    stopCam()
    try {
      const stream = await openMediaStream(nextFacing)
      streamRef.current = stream
      setFacing(nextFacing)
      setCamReady(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCamError(
        `Caméra inaccessible (${msg}). Autorisez la caméra dans le navigateur, ou utilisez « Charger ».`
      )
    } finally {
      setCamBusy(false)
    }
  }

  async function switchFacing(): Promise<void> {
    if (!captureTarget) return
    const next: FacingMode = facing === 'user' ? 'environment' : 'user'
    await startCamera(captureTarget, next)
  }

  function closeCamera(): void {
    stopCam()
    setCaptureTarget(null)
    setCamError(null)
  }

  async function savePhotoToJudoka(judoka: Judoka, dataUrl: string): Promise<void> {
    setBusyId(judoka.id)
    setRowError((prev) => {
      const next = { ...prev }
      delete next[judoka.id]
      return next
    })
    try {
      const up = await window.judovac.savePhotoDataUrl(dataUrl)
      if (!up.ok) {
        setRowError((prev) => ({ ...prev, [judoka.id]: up.error }))
        return
      }
      const res = await window.judovac.updateJudoka(judoka.id, {
        ...judoka,
        photoPath: up.data.path
      })
      if (!res.ok) {
        setRowError((prev) => ({ ...prev, [judoka.id]: res.error }))
        return
      }
      setItems((prev) => prev.filter((x) => x.id !== judoka.id))
      onUpdated?.()
      closeCamera()
    } catch (e) {
      setRowError((prev) => ({
        ...prev,
        [judoka.id]: e instanceof Error ? e.message : 'Photo impossible'
      }))
    } finally {
      setBusyId(null)
    }
  }

  async function snap(): Promise<void> {
    const video = videoRef.current
    const judoka = captureTarget
    if (!video || !judoka) return
    setCamBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponible')
      ctx.drawImage(video, 0, 0)
      await savePhotoToJudoka(judoka, canvas.toDataURL('image/jpeg', 0.82))
    } catch (e) {
      setCamError(e instanceof Error ? e.message : 'Capture impossible')
    } finally {
      setCamBusy(false)
    }
  }

  function openImport(id: string): void {
    importTargetRef.current = id
    fileInputRef.current?.click()
  }

  async function applyImportFile(file: File | undefined): Promise<void> {
    const id = importTargetRef.current
    importTargetRef.current = null
    if (!file || !id) return
    const judoka = items.find((j) => j.id === id)
    if (!judoka) return
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Lecture du fichier impossible'))
        reader.readAsDataURL(file)
      })
      await savePhotoToJudoka(judoka, dataUrl)
    } catch (e) {
      setRowError((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : 'Photo impossible'
      }))
    }
  }

  if (captureTarget) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/60"
          aria-label="Fermer la caméra"
          onClick={closeCamera}
        />
        <div className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-xl border bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="font-display text-base font-semibold text-judo-navy">
                Photographier
              </h2>
              <p className="text-sm text-muted-foreground">{formatJudokaFullName(captureTarget)}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={closeCamera} aria-label="Fermer">
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="space-y-3 p-4">
            <div className="relative mx-auto aspect-[3/4] w-full max-w-[280px] overflow-hidden rounded-lg border bg-black">
              <video
                ref={videoRef}
                className={`h-full w-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
                muted
                playsInline
                autoPlay
              />
              {!camReady && !camError && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                  {camBusy ? 'Ouverture caméra…' : 'Caméra'}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg border p-1">
              <button
                type="button"
                disabled={camBusy}
                onClick={() => void startCamera(captureTarget, 'environment')}
                className={`rounded-md px-2 py-2 text-xs font-semibold ${
                  facing === 'environment' ? 'bg-judo-navy text-white' : 'bg-transparent text-judo-navy'
                }`}
              >
                Caméra arrière
              </button>
              <button
                type="button"
                disabled={camBusy}
                onClick={() => void startCamera(captureTarget, 'user')}
                className={`rounded-md px-2 py-2 text-xs font-semibold ${
                  facing === 'user' ? 'bg-judo-navy text-white' : 'bg-transparent text-judo-navy'
                }`}
              >
                Caméra avant
              </button>
            </div>

            {camError && <p className="text-xs text-destructive">{camError}</p>}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="accent"
                className="flex-1"
                disabled={!camReady || camBusy || busyId === captureTarget.id}
                onClick={() => void snap()}
              >
                <Camera className="h-4 w-4" />
                {busyId === captureTarget.id ? 'Enregistrement…' : 'Capturer'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={camBusy}
                onClick={() => void switchFacing()}
                title="Basculer avant/arrière"
              >
                <SwitchCamera className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" onClick={closeCamera}>
                Annuler
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
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
                        onClick={() => void startCamera(j, 'environment')}
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
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void applyImportFile(file)
        }}
      />
    </div>
  )
}
