# Test sync LAN (smoke)

## Objectif

Vérifier rapidement que le serveur Express + Socket.IO :
- répond au healthcheck
- accepte 2 clients
- enregistre les postes
- ACK heartbeat
- ACK upsert judoka (stockage JSON local)

## Lancer

```bash
npm run test:sync
```

Port de test par défaut : `3848` (`JUDVAC_SERVER_PORT + 1`), surcharge :

```bash
set JUDVAC_TEST_PORT=3900
npm run test:sync
```
