import { useState, type FormEvent } from 'react'
import { Monitor, Server, Wifi } from 'lucide-react'
import { DEFAULT_SERVER_PORT } from '@shared/constants/app'
import type { ModeConfig } from '@shared/types/mode'
import { clientConnectSchema } from '@shared/validation/judoka'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import brandLogo from '@/assets/brand-logo.png'

interface Props {
  onConfigured: (config: ModeConfig) => void
}

type Step = 'choose' | 'client-form'

/**
 * Écran de boot : choix Serveur / Client.
 * Aucun mot de passe — identification métier uniquement (client).
 */
export function ModeSelectPage({ onConfigured }: Props) {
  const [step, setStep] = useState<Step>('choose')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [workstation, setWorkstation] = useState('')
  const [serverHost, setServerHost] = useState('')

  async function startServer(): Promise<void> {
    setBusy(true)
    setError(null)
    const config: ModeConfig = {
      mode: 'server',
      configuredAt: new Date().toISOString()
    }
    const res = await window.judovac.setMode(config)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Échec démarrage serveur')
      return
    }
    onConfigured(config)
  }

  async function startClient(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    const parsed = clientConnectSchema.safeParse({
      username,
      workstation,
      serverHost,
      serverPort: DEFAULT_SERVER_PORT
    })

    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Formulaire invalide')
      return
    }

    setBusy(true)
    const config: ModeConfig = {
      mode: 'client',
      username: parsed.data.username,
      workstation: parsed.data.workstation,
      serverHost: parsed.data.serverHost,
      serverPort: parsed.data.serverPort,
      configuredAt: new Date().toISOString()
    }

    const res = await window.judovac.setMode(config)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Connexion au serveur impossible')
      return
    }
    onConfigured(config)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Fond dégradé bleu plein écran */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(155deg, #061428 0%, #0B1F3A 28%, #143A66 58%, #1E5A8C 82%, #2A7AB0 100%)'
        }}
      />
      <div
        className="pointer-events-none absolute -left-[20%] -top-[25%] h-[70vmax] w-[70vmax] rounded-full opacity-50"
        style={{
          background:
            'radial-gradient(circle, rgba(96,165,250,0.45) 0%, rgba(37,99,235,0.18) 45%, transparent 70%)'
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-[30%] -right-[15%] h-[65vmax] w-[65vmax] rounded-full opacity-45"
        style={{
          background:
            'radial-gradient(circle, rgba(56,189,248,0.35) 0%, rgba(14,116,144,0.2) 40%, transparent 72%)'
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.55) 0.8px, transparent 0.8px)',
          backgroundSize: '28px 28px'
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
        style={{
          background: 'linear-gradient(to top, rgba(6,20,40,0.55), transparent)'
        }}
      />

      <main className="relative z-10 flex flex-1 flex-col justify-center px-8 py-12 md:px-16 lg:px-24">
        <img
          src={brandLogo}
          alt="JudoVACapp"
          className="mb-6 h-24 w-24 animate-fade-up rounded-full object-cover shadow-2xl shadow-sky-950/50 ring-4 ring-white/20 md:h-28 md:w-28"
        />
        <p className="mb-4 animate-fade-up font-display text-5xl font-semibold tracking-tight text-white md:text-7xl">
          JudoVACapp
        </p>
        <h1
          className="max-w-xl animate-fade-up text-xl text-sky-100/90 md:text-2xl"
          style={{ animationDelay: '120ms' }}
        >
          Enregistrement des judokas
        </h1>

        {step === 'choose' && (
          <div
            className="mt-12 flex animate-fade-up flex-wrap gap-4"
            style={{ animationDelay: '220ms' }}
          >
            <Button
              size="lg"
              variant="accent"
              disabled={busy}
              onClick={() => void startServer()}
              className="min-w-[200px] shadow-lg shadow-sky-950/40 transition-transform duration-300 hover:-translate-y-0.5"
            >
              <Server className="h-5 w-5" />
              Mode Serveur
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={busy}
              onClick={() => setStep('client-form')}
              className="min-w-[200px] bg-white/95 text-judo-navy shadow-lg shadow-sky-950/30 transition-transform duration-300 hover:-translate-y-0.5 hover:bg-white"
            >
              <Monitor className="h-5 w-5" />
              Mode Client
            </Button>
          </div>
        )}

        {step === 'client-form' && (
          <form
            onSubmit={(e) => void startClient(e)}
            className="mt-10 w-full max-w-md space-y-4 rounded-xl border border-white/20 bg-white p-6 shadow-2xl shadow-sky-950/40"
          >
            <div className="flex items-center gap-2 text-judo-navy">
              <Wifi className="h-5 w-5 text-sky-600" />
              <h2 className="text-lg font-semibold">Connexion au serveur</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Identifiant utilisateur</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Identifiant créé par le Serveur"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Utilisez exactement l’identifiant créé dans Configuration → Utilisateurs sur le
                serveur. Cela permet de vous reconnecter et de retrouver vos judokas.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workstation">Nom du poste</Label>
              <Input
                id="workstation"
                value={workstation}
                onChange={(e) => setWorkstation(e.target.value)}
                placeholder="Ex. Accueil-01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serverHost">Adresse IP du serveur</Label>
              <Input
                id="serverHost"
                value={serverHost}
                onChange={(e) => setServerHost(e.target.value)}
                placeholder="Ex. 192.168.1.10"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setStep('choose')} disabled={busy}>
                Retour
              </Button>
              <Button type="submit" variant="accent" disabled={busy} className="flex-1">
                {busy ? 'Connexion…' : 'Se connecter'}
              </Button>
            </div>
          </form>
        )}

        {error && step === 'choose' && (
          <p className="mt-6 max-w-md rounded-md bg-black/50 px-4 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {busy && step === 'choose' && (
          <p className="mt-6 text-sm text-sky-100/75">Démarrage du serveur local…</p>
        )}
      </main>
    </div>
  )
}
