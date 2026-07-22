# Déploiement Web — Vercel + Supabase

JudoVACapp est désormais disponible en **application Web** (React + Vite), déployable sur **Vercel** avec **Supabase** comme backend.

## Architecture

| Composant | Rôle |
|-----------|------|
| **Frontend** (`src/`) | React, Tailwind, Radix — réutilise l'UI existante |
| **Supabase** | Auth, PostgreSQL (judokas, profils, settings), Storage (photos) |
| **API Vercel** (`api/`) | Export PDF, vérification badges, gestion utilisateurs admin |

Le client web (`src/lib/judovac-client.ts`) remplace `window.judovac` Electron/IPC par des appels Supabase + API REST.

## 1. Configurer Supabase

1. Créez un projet sur [supabase.com](https://supabase.com)
2. Exécutez la migration SQL : `supabase/migrations/001_initial_schema.sql`
3. Créez les buckets Storage :
   - `photos` — public en lecture (ou signed URLs)
   - `badge-assets` — public en lecture
4. Créez le premier administrateur dans **Authentication → Users** :
   - Email : `admin@votre-domaine.com`
   - Mot de passe : (votre choix)
5. Mettez à jour le profil en SQL :
   ```sql
   UPDATE profiles SET role = 'admin', username = 'admin' WHERE id = '<uuid-utilisateur>';
   ```

## 2. Variables d'environnement

Copiez `.env.example` vers `.env.local` :

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Sur **Vercel**, ajoutez les mêmes variables dans Project Settings → Environment Variables.

## 3. Développement local

```bash
npm install
npm run dev:web          # Frontend seul (port 5173)
npm run dev:vercel       # Frontend + API routes (recommandé)
```

## 4. Déploiement Vercel

```bash
npm run build:web
# ou connectez le repo GitHub à Vercel — build command : npm run build:web
```

Le fichier `vercel.json` configure le routage SPA et les fonctions serverless.

## Rôles utilisateurs

| Rôle | Accès |
|------|-------|
| **admin** | Tableau de bord complet, configuration, badges, sauvegarde |
| **operator** | Enregistrement judokas (ses propres fiches), liste, sync cloud instantanée |

Les opérateurs sont créés par l'admin via **Configuration → Utilisateurs** (API `/api/admin/users`).

## Applications Android

### JudoVACapp Scanner (`mobile/`)

Authentifie les QR codes des badges contre le **cloud** (tous les judokas enregistrés en ligne).

- Mode Cloud par défaut : `https://judo-va-capp.vercel.app`
- API : `GET /api/health`, `GET /api/badges/verify?id=…&displayId=…`
- Build : `cd mobile; .\scripts\build-apk.ps1` → `JudoVACapp-scanner-1.1.0.apk`
- Mode « Serveur local » optionnel pour Electron LAN

### JudoVAC-mobile (`mobile-app/`)

Système **complet** (mêmes données Supabase / Vercel que le web) :

- Login, dashboard, CRUD judokas + photos, designer badge, export PDF, sauvegarde, admin utilisateurs
- Build : `cd mobile-app; .\scripts\build-apk.ps1` → `JudoVAC-mobile-1.0.0.apk`

Voir `mobile/README.md` et `mobile-app/README.md`.

## Différences vs version Electron

- Pas de mode LAN Serveur/Client — tout passe par le cloud
- Authentification email/mot de passe (Supabase Auth)
- Impression via PDF + navigateur (plus d'API imprimante native)
- Sauvegarde en JSON téléchargeable (remplace les fichiers `.jvac` locaux)
- Sync instantanée (plus de file d'attente offline)

La version Electron reste disponible via `npm run dev` / `npm run dist` pour un usage offline/LAN.
