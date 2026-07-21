# JudoVACapp

Application Desktop Windows **offline** pour l’enregistrement des judokas
(compétitions, examens, stages). Modes **Serveur** et **Client** sur réseau local.

## Stack

Electron · React · TypeScript · Tailwind · Shadcn UI · Node/Express · JSON local · Socket.IO · PDFKit · qrcode

## Prérequis

- Node.js 20+
- Windows 10/11

## Installation

```bash
npm install
copy .env.example .env
npm run dev
```

### Si `npm` n’est pas reconnu (Windows)

Node.js est installé mais hors du PATH de la session. Utilisez :

```powershell
.\dev.bat
# ou
.\dev.ps1
```

Puis **rouvrez le terminal** pour que `npm` soit disponible (PATH utilisateur corrigé avec `C:\Program Files\nodejs`).

## Architecture

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/PROGRESS.md](docs/PROGRESS.md).

## Modes

| Mode | Rôle |
|------|------|
| **Serveur** | Stockage local JSON, fichiers, sync, badges, PDF, sauvegardes `.jvac`, admin |
| **Client** | Saisie + file d’attente locale + sync auto vers le serveur |

## Fonctionnalités livrées

- Sélection Serveur / Client au démarrage
- Dashboards + journal (serveur)
- CRUD judoka + détection doublons + recherche filtrée
- Sync LAN Socket.IO + file offline persistante
- Photo webcam / import JPG-PNG
- Designer de badge (positions, couleurs, fond, logo) + export PDF (4/6/8)
- Impression directe (Electron Printer API)
- Sauvegarde / restauration `.jvac` (gzip + SHA-256)
- Administration (événement, paramètres impression, couleurs, journal)
- Édition / suppression judoka depuis la liste
- Packaging Windows NSIS (`npm run dist`)

## Installateur Windows

```bash
npm run dist
```

Voir [docs/PACKAGING.md](docs/PACKAGING.md). Installateur dans `release/`.

## Port LAN

`3847` (HTTP API + Socket.IO) — configurable via `.env`.
