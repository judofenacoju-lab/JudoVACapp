/**
 * Écran affiché si VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquent sur Vercel.
 */
export function ConfigErrorPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-8 text-center">
      <h1 className="font-display text-2xl font-bold text-judo-navy">Configuration manquante</h1>
      <p className="mt-3 max-w-lg text-sm text-muted-foreground">
        Les variables d&apos;environnement Supabase ne sont pas définies sur Vercel. Sans elles,
        l&apos;application ne peut pas démarrer.
      </p>
      <ol className="mt-6 max-w-md list-decimal space-y-2 text-left text-sm text-foreground">
        <li>
          Vercel → Project → <strong>Settings → Environment Variables</strong>
        </li>
        <li>
          Ajoutez <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> et{' '}
          <code className="rounded bg-muted px-1">VITE_SUPABASE_ANON_KEY</code>
        </li>
        <li>
          Puis aussi <code className="rounded bg-muted px-1">SUPABASE_URL</code> et{' '}
          <code className="rounded bg-muted px-1">SUPABASE_SERVICE_ROLE_KEY</code> (API)
        </li>
        <li>
          Redéployez : Deployments → ⋯ → <strong>Redeploy</strong>
        </li>
      </ol>
    </div>
  )
}
