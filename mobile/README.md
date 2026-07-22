# JudoVACapp Scanner — Authentification badges QR

APK : **JudoVACapp-scanner** (`com.judovacapp.scanner`)

Scanne les QR codes des badges et authentifie les judokas enregistrés dans le **cloud** (mêmes données que https://judo-va-capp.vercel.app).

## Modes

| Mode | Usage |
|------|--------|
| **Cloud** (défaut) | Vérifie tous les badges en ligne via `/api/badges/verify` |
| **Serveur local** | Rétrocompatibilité Electron LAN (`IP:3847`) |

## Développement

```bash
cd mobile
npm install
npx expo start
```

## Build APK

```powershell
cd mobile
.\scripts\build-apk.ps1
# → mobile/release/JudoVACapp-scanner-1.1.0.apk
```

Ou EAS :

```bash
npm run build:apk
```

## API

- `GET /api/health` → `{ ok: true }`
- `GET /api/badges/verify?id=...&displayId=...` → `{ ok: true, badge: { fullName, category, weight, sex, displayId } }`
