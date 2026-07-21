# JudoVACapp Mobile — Scanner QR

Application mobile pour **authentifier les badges judokas** en scannant le QR code imprimé sur le badge.

## Prérequis

- Node.js 18+
- Téléphone Android ou iOS sur le **même réseau Wi‑Fi** que le PC serveur JudoVACapp
- Le serveur JudoVACapp doit être **démarré** (mode Serveur)

## Installation

```bash
cd mobile
npm install
npx expo start
```

Scannez le QR Expo avec l’application **Expo Go** (Android/iOS) ou lancez sur émulateur :

```bash
npm run android
npm run ios
```

## Utilisation

1. Au premier lancement, saisissez l’**adresse IP** du serveur (visible dans **Configuration → Réseau** sur le PC).
2. Port par défaut : **3847**
3. Scannez le QR code d’un badge.
4. Si le judoka existe sur le serveur, les informations du badge s’affichent (nom, catégorie, poids, sexe, n° badge).
5. Sinon : « Badge non reconnu sur ce serveur ».

## API utilisée

`GET http://<IP>:3847/api/badges/verify?id=...&displayId=...`

Le payload QR est celui généré à l’export/impression PDF des badges.
