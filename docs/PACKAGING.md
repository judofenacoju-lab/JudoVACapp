# Packaging Windows

## Préparer l’icône

```bash
npm run icon:build
```

Produit `build/icon.png` (utilisé par electron-builder pour l’exe / NSIS / raccourcis).

## Générer l’installateur

```bash
npm install
npm run build
npm run dist
```

Résultat : `release/JudoVACapp-*-Setup.exe`

Test sans installer :

```bash
npm run dist:dir
```

## Après installation

- Le fichier `.env` est créé dans le dossier userData au premier lancement
  (copie de `.env.example` embarqué).
- Configurer le port LAN si besoin (`userData/.env`).
- Les sauvegardes `.jvac` sont associées à JudoVACapp (double-clic préparé côté installer).
- Données judokas : `%APPDATA%\judovacapp\data\judokas.json`.

## Emplacement userData (Windows)

`%APPDATA%\judovacapp\`
