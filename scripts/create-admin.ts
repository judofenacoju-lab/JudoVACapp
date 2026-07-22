/**
 * Crée ou met à jour le compte administrateur Supabase.
 * Usage : npm run admin:create
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
const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

const ADMIN_EMAIL = env.ADMIN_EMAIL ?? 'judovac@mail.com'
const ADMIN_PASSWORD = env.ADMIN_PASSWORD ?? '@Fenacoju'
const ADMIN_USERNAME = env.ADMIN_USERNAME ?? 'admin'

if (!url || !serviceKey) {
  console.error('❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function main(): Promise<void> {
  console.log(`Création admin : ${ADMIN_EMAIL}`)

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: {
      username: ADMIN_USERNAME,
      display_name: 'Administrateur',
      role: 'admin'
    }
  })

  let userId = created?.user?.id

  if (createErr) {
    if (!/already|exists|registered/i.test(createErr.message)) {
      console.error('❌ Erreur création :', createErr.message)
      process.exit(1)
    }
    console.log('ℹ️  Utilisateur existant — mise à jour du mot de passe…')
    const { data: list } = await supabase.auth.admin.listUsers()
    const existing = list?.users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase())
    if (!existing) {
      console.error('❌ Utilisateur introuvable malgré le conflit email')
      process.exit(1)
    }
    userId = existing.id
    const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        username: ADMIN_USERNAME,
        display_name: 'Administrateur',
        role: 'admin'
      }
    })
    if (updateErr) {
      console.error('❌ Erreur mise à jour :', updateErr.message)
      process.exit(1)
    }
  }

  if (!userId) {
    console.error('❌ ID utilisateur manquant')
    process.exit(1)
  }

  const { error: profileErr } = await supabase.from('profiles').upsert({
    id: userId,
    username: ADMIN_USERNAME,
    display_name: 'Administrateur',
    role: 'admin',
    active: true
  })

  if (profileErr) {
    console.error('❌ Erreur profil :', profileErr.message)
    console.log('   → Avez-vous exécuté supabase/migrations/001_initial_schema.sql ?')
    process.exit(1)
  }

  console.log('')
  console.log('✅ Compte admin prêt')
  console.log('──────────────────────────────')
  console.log('  Email      :', ADMIN_EMAIL)
  console.log('  Mot de passe :', ADMIN_PASSWORD)
  console.log('  Rôle       : admin')
  console.log('──────────────────────────────')
  console.log('Connectez-vous sur : https://judo-va-capp.vercel.app/login')
}

void main()
