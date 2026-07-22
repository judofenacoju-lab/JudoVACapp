# JudoVAC-mobile — Système complet (Android)

APK : **JudoVAC-mobile** (`com.judovacapp.mobile`)

Application mobile connectée aux **mêmes données cloud** que https://judo-va-capp.vercel.app :

- Connexion Supabase (admin / opérateur)
- Tableau de bord
- CRUD judokas + photos
- Designer de badge
- Export / impression PDF (partage)
- Sauvegarde JSON
- Configuration utilisateurs (admin)

## Configuration

Copiez `.env.example` → `.env` :

```env
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_API_BASE=https://judo-va-capp.vercel.app
```

## Développement

```bash
cd mobile-app
npm install
npx expo start
```

## Build APK

```powershell
cd mobile-app
.\scripts\build-apk.ps1
# → mobile-app/release/JudoVAC-mobile-1.0.0.apk
```

Ou EAS : `npm run build:apk`
