import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import brandLogo from '@/assets/brand-logo.png'

/**
 * Connexion Supabase — remplace l'écran Serveur/Client du mode desktop.
 */
export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEmail('')
    setPassword('')
    setShowPassword(false)
    setError(null)
  }, [])

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await signIn(email.trim(), password)
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setEmail('')
    setPassword('')
    navigate(res.role === 'admin' ? '/dashboard' : '/app', { replace: true })
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-judo-navy via-[#0f2847] to-judo-navy p-6">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute -left-20 -top-20 h-72 w-72 animate-home-drift rounded-full bg-judo-red/20 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 animate-home-drift-alt rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={brandLogo} alt="JudoVACapp" className="mb-4 h-20 w-20 rounded-2xl shadow-lg" />
          <h1 className="font-display text-3xl font-bold text-white">JudoVACapp</h1>
          <p className="mt-2 text-sm text-white/70">
            Gestion des enregistrements judokas - version Web
          </p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          autoComplete="off"
          className="space-y-5 rounded-2xl border border-white/10 bg-white/95 p-8 shadow-2xl backdrop-blur"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="judovac-email"
              type="email"
              autoComplete="off"
              placeholder="xxxx@mail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <div className="relative">
              <Input
                id="password"
                name="judovac-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder=""
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {busy ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>
      </div>
    </div>
  )
}
