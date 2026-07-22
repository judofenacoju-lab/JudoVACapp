import type { VercelRequest, VercelResponse } from '@vercel/node'

import { requireAdmin } from '../../core/infrastructure/supabase/admin-auth'



function toLoginEmail(username: string): string {

  const slug = username.trim().toLowerCase().replace(/\s+/g, '')

  return `${slug}@mail.com`

}



function generatePassword(): string {

  const base = Math.random().toString(36).slice(2, 8)

  return `Jv@${base}1`

}



export default async function handler(req: VercelRequest, res: VercelResponse) {

  try {

    const ctx = await requireAdmin(req)

    if (!ctx) {

      return res.status(401).json({ ok: false, error: 'Accès admin requis' })

    }



    const { supabase } = ctx



    if (req.method === 'POST') {

      const { username, displayName, role = 'operator', password } = req.body as {

        username?: string

        displayName?: string

        role?: string

        password?: string

      }



      if (!username?.trim()) {

        return res.status(400).json({ ok: false, error: 'Nom d\'utilisateur requis' })

      }



      const cleanUsername = username.trim()

      if (cleanUsername.toLowerCase() === 'admin') {

        return res.status(400).json({ ok: false, error: 'Le nom « admin » est réservé' })

      }



      const email = toLoginEmail(cleanUsername)

      const userPassword = password?.trim() || generatePassword()



      const { data: created, error } = await supabase.auth.admin.createUser({

        email,

        password: userPassword,

        email_confirm: true,

        user_metadata: {

          username: cleanUsername,

          display_name: displayName ?? '',

          role: role === 'admin' ? 'admin' : 'operator'

        }

      })



      if (error) return res.status(400).json({ ok: false, error: error.message })



      await supabase.from('profiles').upsert({

        id: created.user.id,

        username: cleanUsername,

        display_name: displayName ?? '',

        role: role === 'admin' ? 'admin' : 'operator',

        active: true

      })



      return res.status(200).json({

        ok: true,

        data: {

          id: created.user.id,

          username: cleanUsername,

          displayName: displayName ?? undefined,

          active: true,

          createdAt: new Date().toISOString(),

          role: role === 'admin' ? 'admin' : 'operator',

          email,

          password: userPassword

        }

      })

    }



    if (req.method === 'DELETE') {

      const username = req.query.username as string

      if (!username) return res.status(400).json({ ok: false, error: 'username requis' })



      if (username.toLowerCase() === 'admin') {

        return res.status(400).json({ ok: false, error: 'Le compte administrateur ne peut pas être supprimé' })

      }



      const { data: profile } = await supabase

        .from('profiles')

        .select('id, role')

        .eq('username', username)

        .single()



      if (!profile) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable' })



      if (profile.role === 'admin') {

        return res.status(400).json({ ok: false, error: 'Le compte administrateur ne peut pas être supprimé' })

      }



      await supabase.from('profiles').delete().eq('id', profile.id)

      await supabase.auth.admin.deleteUser(profile.id)



      return res.status(200).json({ ok: true })

    }



    return res.status(405).json({ ok: false, error: 'Method not allowed' })

  } catch (error) {

    const message = error instanceof Error ? error.message : 'Erreur serveur'

    if (message.includes('Variables Supabase serveur manquantes')) {

      return res.status(503).json({

        ok: false,

        error:

          'Configuration serveur incomplète. Ajoutez SUPABASE_SERVICE_ROLE_KEY sur Vercel (même projet Supabase que VITE_SUPABASE_URL).'

      })

    }

    console.error('api/admin/users error:', message)

    return res.status(500).json({ ok: false, error: message })

  }

}


