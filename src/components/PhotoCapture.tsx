import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, SwitchCamera, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  value: string | null
  onChange: (path: string | null) => void
}

type FacingMode = 'user' | 'environment'

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

  // Heuristique courante Android : index 0 = arrière, 1 = avant
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
 * Capture webcam avant/arrière (tablette & téléphone) ou import JPG/PNG.
 */
export function PhotoCapture({ value, onChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rearInputRef = useRef<HTMLInputElement>(null)
  const frontInputRef = useRef<HTMLInputElement>(null)
  const [camOn, setCamOn] = useState(false)
  const [facing, setFacing] = useState<FacingMode>('environment')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return () => stopCam()
  }, [])

  useEffect(() => {
    if (!camOn || !streamRef.current || !videoRef.current) return
    const video = videoRef.current
    video.srcObject = streamRef.current
    void video.play().catch(() => {
      setError("Impossible de démarrer l'aperçu webcam.")
    })
  }, [camOn, facing])

  useEffect(() => {
    if (!value || preview) return
    let cancelled = false
    void (async () => {
      const res = await window.judovac.readPhotoDataUrl(value)
      if (cancelled || !res.ok) return
      setPreview(res.data.dataUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [value, preview])

  async function openCamera(nextFacing: FacingMode): Promise<void> {
    setError(null)
    setBusy(true)
    stopCam()
    try {
      const stream = await openMediaStream(nextFacing)
      streamRef.current = stream
      setFacing(nextFacing)
      setCamOn(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        `Caméra inaccessible (${msg}). Autorisez la caméra, ou utilisez « Appareil photo » ci-dessous.`
      )
    } finally {
      setBusy(false)
    }
  }

  async function switchFacing(): Promise<void> {
    const next: FacingMode = facing === 'user' ? 'environment' : 'user'
    await openCamera(next)
  }

  function stopCam(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOn(false)
  }

  async function uploadDataUrl(dataUrl: string): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await window.judovac.savePhotoDataUrl(dataUrl)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setPreview(res.data.dataUrl ?? dataUrl)
    onChange(res.data.path)
    stopCam()
  }

  async function snap(): Promise<void> {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    await uploadDataUrl(canvas.toDataURL('image/jpeg', 0.82))
  }

  async function onNativeCapture(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Lecture du fichier impossible'))
        reader.readAsDataURL(file)
      })
      await uploadDataUrl(dataUrl)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function importFile(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await window.judovac.importPhotoFile()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    if (!res.data.path) return
    onChange(res.data.path)
    if (res.data.dataUrl) {
      setPreview(res.data.dataUrl)
    } else {
      const previewRes = await window.judovac.readPhotoDataUrl(res.data.path)
      if (previewRes.ok) setPreview(previewRes.data.dataUrl)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="text-sm font-semibold text-judo-navy">Photo</h3>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex h-44 w-36 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          <video
            ref={videoRef}
            className={`h-full w-full object-cover ${camOn ? 'block' : 'hidden'} ${
              facing === 'user' ? 'scale-x-[-1]' : ''
            }`}
            muted
            playsInline
            autoPlay
          />
          {!camOn && preview && (
            <img src={preview} alt="Aperçu photo" className="h-full w-full object-cover" />
          )}
          {!camOn && !preview && <Camera className="h-8 w-8 text-muted-foreground/50" />}
        </div>

        <div className="flex min-w-[11rem] flex-1 flex-col gap-2">
          {!camOn ? (
            <>
              <p className="text-[11px] font-medium text-judo-navy">Aperçu en direct</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-11"
                  onClick={() => void openCamera('environment')}
                  disabled={busy}
                >
                  <Camera className="h-4 w-4" />
                  Arrière
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-11"
                  onClick={() => void openCamera('user')}
                  disabled={busy}
                >
                  <Camera className="h-4 w-4" />
                  Avant
                </Button>
              </div>

              <p className="mt-1 text-[11px] font-medium text-judo-navy">Appareil photo natif</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11"
                  disabled={busy}
                  onClick={() => rearInputRef.current?.click()}
                >
                  Photo arrière
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11"
                  disabled={busy}
                  onClick={() => frontInputRef.current?.click()}
                >
                  Photo avant
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openCamera('environment')}
                  className={`rounded-md px-2 py-2 text-xs font-semibold ${
                    facing === 'environment' ? 'bg-judo-navy text-white' : 'text-judo-navy'
                  }`}
                >
                  Arrière
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openCamera('user')}
                  className={`rounded-md px-2 py-2 text-xs font-semibold ${
                    facing === 'user' ? 'bg-judo-navy text-white' : 'text-judo-navy'
                  }`}
                >
                  Avant
                </button>
              </div>
              <Button type="button" variant="accent" size="sm" className="h-11" onClick={() => void snap()} disabled={busy}>
                Capturer
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void switchFacing()}
                disabled={busy}
              >
                <SwitchCamera className="h-4 w-4" />
                Basculer
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={stopCam}>
                Arrêter
              </Button>
            </>
          )}

          <Button type="button" variant="outline" size="sm" onClick={() => void importFile()} disabled={busy}>
            <ImagePlus className="h-4 w-4" />
            Importer JPG/PNG
          </Button>
          <p className="text-[11px] text-muted-foreground">Max. 10 Mo — compressé automatiquement</p>
          {(value || preview) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null)
                setPreview(null)
              }}
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </Button>
          )}
        </div>
      </div>

      <input
        ref={rearInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void onNativeCapture(file)
        }}
      />
      <input
        ref={frontInputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void onNativeCapture(file)
        }}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
      {preview && !camOn && (
        <p className="text-xs text-emerald-700">Photo prête — visible ci-dessus avant enregistrement.</p>
      )}
    </div>
  )
}
