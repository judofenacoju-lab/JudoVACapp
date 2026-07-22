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

### Local (Windows)

```powershell
cd mobile
.\scripts\build-apk.ps1
# → mobile/release/JudoVACapp-scanner-1.1.0.apk
```

Prérequis : JDK 17 + Android SDK (téléchargés automatiquement dans `mobile/.tools/`).  
Si le NDK échoue (chemin avec espaces / réseau), utilisez EAS.

### EAS (recommandé)

```bash
cd mobile
npx eas login
npm run build:apk
```

Ou depuis la racine : `npm run build:apk:scanner`
## API

- `GET /api/health` → `{ ok: true }`
- `GET /api/badges/verify?id=...&displayId=...` → `{ ok: true, badge: { fullName, category, weight, sex, displayId } }`
