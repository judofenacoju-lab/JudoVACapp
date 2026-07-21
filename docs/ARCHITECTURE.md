# Architecture JudoVACapp

## Vue d'ensemble

Application Desktop Windows **offline-first**, dual-mode **Serveur / Client**,
synchronisation LAN via Socket.IO + HTTP Express, persistance **JSON locale**
(serveur) et file d'attente locale (client).

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer (React)                        │
│  Pages · Features · UI (Shadcn/Tailwind) · Zustand stores   │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge (IPC)
┌──────────────────────────▼──────────────────────────────────┐
│                   Electron Main Process                     │
│  Mode manager · Fenêtres · Printer · Webcam bridges         │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
     Mode SERVEUR                    Mode CLIENT
                │                             │
┌───────────────▼───────────────┐   ┌─────────▼──────────────┐
│  Express + Socket.IO Host     │   │  Socket.IO Client      │
│  JSON local (judokas.json)    │   │  Queue locale (JSON)   │
│  File Storage (photos/assets) │   │  Sync automatique      │
│  PDF / Badge / Backup .jvac   │   └────────────────────────┘
└───────────────────────────────┘
```

## Couches (Clean Architecture)

| Couche | Emplacement | Responsabilité |
|--------|-------------|----------------|
| **Shared** | `shared/` | Types, contrats IPC/Socket, Zod, constantes |
| **Domain** | `core/domain/` | Entités, ports (interfaces repository), erreurs |
| **Application** | `core/application/` | Use cases, DTO, orchestration |
| **Infrastructure** | `core/infrastructure/` | JSON store, filesystem, PDFKit, QR, backup |
| **Server** | `server/` | Express routes, Socket.IO, middleware |
| **Electron** | `electron/` | Main, preload, IPC handlers |
| **UI** | `src/` | React features, pages, composants |

## Stockage

Voir [DATABASE.md](DATABASE.md).
