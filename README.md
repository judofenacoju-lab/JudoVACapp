# JudoVACapp

Application **Web** (Vercel + Supabase) et Desktop Windows pour l’enregistrement des judokas
(compétitions, examens, stages).

## Stack

Electron · React · TypeScript · Tailwind · Vite · Supabase · Vercel

## Prérequis

- Node.js 20+
- Compte Supabase + variables dans `.env` (voir `.env.example`)

## Installation

```bash
npm install
copy .env.example .env
npm run dev:web
```

## Déploiement Web

Voir [docs/DEPLOY-WEB.md](docs/DEPLOY-WEB.md).

```bash
npm run build:web
```

Build command Vercel : `npm run build:web` — Output : `dist`

## Version Desktop (Electron)

```bash
npm run dev
npm run dist
```

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/PACKAGING.md](docs/PACKAGING.md).
