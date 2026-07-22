import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  value: string | null
  onChange: (path: string | null) => void
}

/**
 * Capture webcam ou import JPG/PNG — upload Cloud (Supabase Storage).
 */
export function PhotoCapture({ value, onChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [camOn, setCamOn] = useState(false)
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
  }, [camOn])

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

  async function startCam(): Promise<void> {
    setError(null)
    stopCam()
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Webcam non disponible. Utilisez « Importer JPG/PNG » ou HTTPS.')
        return
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      streamRef.current = stream
      setCamOn(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        `Webcam inaccessible (${msg}). Autorisez la caméra dans le navigateur, ou importez une image JPG/PNG.`
      )
    }
  }

  function stopCam(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOn(false)
  }

  async function snap(): Promise<void> {
    const video = videoRef.current
    if (!video) return
    setBusy(true)
    setError(null)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setBusy(false)
      return
    }
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
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
    <div className="space-y-3 rounded-xl border bg-white/70 p-4">
      <h3 className="text-sm font-semibold text-judo-navy">Photo</h3>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex h-40 w-32 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          <video
            ref={videoRef}
            className={`h-full w-full object-cover ${camOn ? 'block' : 'hidden'}`}
            muted
            playsInline
            autoPlay
          />
          {!camOn && preview && (
            <img src={preview} alt="Aperçu photo" className="h-full w-full object-cover" />
          )}
          {!camOn && !preview && <Camera className="h-8 w-8 text-muted-foreground/50" />}
        </div>

        <div className="flex flex-col gap-2">
          {!camOn ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => void startCam()} disabled={busy}>
              <Camera className="h-4 w-4" />
              Webcam
            </Button>
          ) : (
            <>
              <Button type="button" variant="accent" size="sm" onClick={() => void snap()} disabled={busy}>
                Capturer
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

      {error && <p className="text-xs text-destructive">{error}</p>}
      {preview && !camOn && (
        <p className="text-xs text-emerald-700">Photo prête — visible ci-dessus avant enregistrement.</p>
      )}
    </div>
  )
}
