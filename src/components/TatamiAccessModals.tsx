import { useEffect, useState } from 'react'
import { Copy, Timer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { tatamiDisplayLabel, type Tatami } from '@shared/types/combats'
import { chronoListenPort, detectLanIpv4Addresses } from '@/lib/detect-lan-ip'

interface Props {
  tatamis: Tatami[]
  onClose: () => void
}

/**
 * Accès JVac-Chrono : liste des tatamis, puis IP LAN de cet ordinateur + mot de passe.
 */
export function TatamiAccessModals({ tatamis, onClose }: Props) {
  const [selected, setSelected] = useState<Tatami | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [lanIps, setLanIps] = useState<string[]>([])
  const [serverPort, setServerPort] = useState<number>(3847)
  const [copied, setCopied] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setDetecting(true)
      try {
        const status = await window.judovac.getServerStatus()
        const fromStatus = status.ok ? status.data : undefined
        const port = fromStatus ? chronoListenPort(fromStatus.port) : 3847
        const ips = await detectLanIpv4Addresses(fromStatus)
        if (cancelled) return
        setServerPort(port)
        setLanIps(ips)
      } catch {
        if (!cancelled) setLanIps([])
      } finally {
        if (!cancelled) setDetecting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const serverIp = lanIps[0] ?? null

  async function copy(text: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      /* ignore */
    }
  }

  if (selected) {
    const label = tatamiDisplayLabel(selected, selectedIndex)
    const password = selected.password ?? '—'
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/45"
          aria-label="Fermer"
          onClick={() => setSelected(null)}
        />
        <div
          role="dialog"
          aria-modal="true"
          className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-judo-navy">{label}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Connexion JVac-Chrono pour ce tatami
              </p>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={() => setSelected(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div className="rounded-lg border bg-slate-50 px-3 py-3">
              <p className="text-xs text-muted-foreground">
                Adresse IP de cet ordinateur (réseau local)
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono text-lg font-semibold tracking-wide">
                  {detecting
                    ? 'Détection…'
                    : serverIp
                      ? `${serverIp}:${serverPort}`
                      : 'Non détectée'}
                </p>
                {serverIp && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copy(`${serverIp}:${serverPort}`, 'ip')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied === 'ip' ? 'Copié' : 'Copier'}
                  </Button>
                )}
              </div>
              {lanIps.length > 1 && (
                <ul className="mt-2 space-y-1 text-xs font-mono text-muted-foreground">
                  {lanIps.slice(1).map((ip) => (
                    <li key={ip}>
                      {ip}:{serverPort}
                    </li>
                  ))}
                </ul>
              )}
              {!detecting && !serverIp && (
                <p className="mt-2 text-xs text-amber-800">
                  IP locale introuvable. Sur cet ordinateur, notez l’IPv4 du Wi‑Fi / Ethernet
                  (souvent 192.168.x.x) et le port {serverPort}.
                </p>
              )}
            </div>
            <div className="rounded-lg border bg-slate-50 px-3 py-3">
              <p className="text-xs text-muted-foreground">Mot de passe {label}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono text-2xl font-bold tracking-[0.2em] text-judo-navy">
                  {password}
                </p>
                {selected.password && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copy(password, 'pwd')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied === 'pwd' ? 'Copié' : 'Copier'}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sur l’ordinateur chrono (même Wi‑Fi / réseau local), ouvrez{' '}
              <strong>JVac-Chrono</strong> et saisissez cette IP avec le mot de passe : les
              combats de {label} seront pris en charge.
            </p>
            <Button type="button" variant="outline" className="w-full" onClick={() => setSelected(null)}>
              Retour aux tatamis
            </Button>
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
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-judo-navy">Tatamis</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Choisissez un tatami pour afficher l’accès JVac-Chrono
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-2 px-5 py-4">
          {tatamis.map((t, i) => (
            <Button
              key={t.id}
              type="button"
              variant="accent"
              className="w-full justify-start"
              onClick={() => {
                setSelected(t)
                setSelectedIndex(i)
              }}
            >
              <Timer className="h-4 w-4" />
              {tatamiDisplayLabel(t, i)}
              {t.name.trim() && t.name.trim() !== `Tatami ${i + 1}` && t.name.trim() !== `Tatami-${i + 1}` ? (
                <span className="ml-auto text-xs font-normal opacity-80">{t.name}</span>
              ) : null}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
