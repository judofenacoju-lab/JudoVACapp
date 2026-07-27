import { Camera, Scale, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  onClose: () => void
  onOpenUnweighed: () => void
  onOpenUnphotographed: () => void
}

/**
 * Menu après clic sur « Enregistrés » : non pesés / sans photo.
 */
export function RegisteredJudokasMenuModal({
  onClose,
  onOpenUnweighed,
  onOpenUnphotographed
}: Props) {
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
        aria-labelledby="registered-menu-title"
        className="relative z-10 w-full max-w-sm overflow-hidden rounded-xl border bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2
              id="registered-menu-title"
              className="font-display text-lg font-semibold text-judo-navy"
            >
              Judokas enregistrés
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Choisissez une action</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="space-y-3 p-5">
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full justify-start gap-3 text-base"
            onClick={onOpenUnweighed}
          >
            <Scale className="h-5 w-5 text-judo-red" />
            Judokas non pesés
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full justify-start gap-3 text-base"
            onClick={onOpenUnphotographed}
          >
            <Camera className="h-5 w-5 text-judo-red" />
            Judokas non photographiés
          </Button>
        </div>
      </div>
    </div>
  )
}
