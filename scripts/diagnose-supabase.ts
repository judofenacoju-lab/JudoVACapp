/**
 * Diagnostic Supabase : auth, tables, profil admin.
 * Usage : npm run admin:diagnose
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadEnv(): Record<string, string> {
  const path = resolve(process.cwd(), '.env')
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = /^([^#=]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]!.trim()] = m[2]!.trim()
  }
  return out
}

const env = { ...loadEnv(), ...process.env }
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? ''
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const email = env.ADMIN_EMAIL ?? 'judovac@mail.com'
const password = env.ADMIN_PASSWORD ?? '@Fenacoju'

const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '?'

function jwtProjectRef(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { ref?: string }
    return json.ref ?? null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const anonRef = jwtProjectRef(anonKey)
  const serviceRef = jwtProjectRef(serviceKey)
  console.log('')
  console.log('═══ Diagnostic JudoVACapp ═══')
  console.log('Projet Supabase (ref) :', projectRef)
  console.log('URL                   :', url)
  if (anonRef && anonRef !== projectRef) {
    console.log('⚠️  CLEF ANON : projet', anonRef, '≠ URL', projectRef)
  }
  if (serviceRef && serviceRef !== projectRef) {
    console.log('⚠️  CLEF SERVICE : projet', serviceRef, '≠ URL', projectRef)
  }
  console.log('')
  console.log('→ Vérifiez que cette ref correspond à Settings → General → Reference ID')
  console.log('  dans le MÊME projet où vous exécutez le SQL.')
  console.log('  (Le nom affiché "Caisse Judo" ou "JudoVACapp" n\'a pas d\'importance.)')
  console.log('')

  const res = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    }
  })
  console.log('Table profiles :', res.status, res.statusText)
  if (!res.ok) console.log('  →', await res.text())

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { data: users, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) {
    console.error('Liste users :', listErr.message)
  } else {
    const u = users.users.find((x) => x.email?.toLowerCase() === email.toLowerCase())
    console.log('Utilisateur auth :', u ? `${u.email} (${u.id})` : 'INTROUVABLE')
    if (u) {
      const { data: profile, error: pErr } = await admin
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .maybeSingle()
      console.log('Profil :', profile ?? (pErr ? `ERREUR ${pErr.message}` : 'ABSENT'))
    }
  }

  const client = createClient(url, anonKey)
  const { data: login, error: loginErr } = await client.auth.signInWithPassword({ email, password })
  console.log('Test login :', loginErr ? loginErr.message : `OK (${login.user?.email})`)

  if (login.user) {
    const { data: profile, error: pErr } = await client
      .from('profiles')
      .select('*')
      .eq('id', login.user.id)
      .maybeSingle()
    console.log('Profil (anon RLS) :', profile ?? (pErr ? `ERREUR ${pErr.message}` : 'ABSENT'))
  }

  if (res.status === 404) {
    console.log('')
    console.log('⚠️  La table profiles est ABSENTE dans CE projet Supabase.')
    console.log('   → Exécutez supabase/migrations/002_fix_profiles_admin.sql')
    console.log('     dans le projet dont la ref est :', projectRef)
  }
}

void main()
