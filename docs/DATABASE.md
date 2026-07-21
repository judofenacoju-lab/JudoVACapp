# Stockage local JSON (Mode Serveur)

Les judokas, paramètres et journaux sont persistés dans le dossier
`userData` Electron (ex. `%APPDATA%\judovacapp` sur Windows) :

| Fichier / dossier | Contenu |
|-------------------|---------|
| `data/judokas.json` | Judokas |
| `assets/settings.json` | Paramètres admin |
| `logs/system-logs.json` | Journal |
| `photos/` | Photos judoka |
| `assets/` | Fonds / logos badge |
| `queue/` | File de sync (clients) |

Aucune installation PostgreSQL n’est requise.

Sauvegarde / restauration via fichiers `.jvac` (Administration → Sauvegarde).
