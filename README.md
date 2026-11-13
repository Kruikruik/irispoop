# IRIS//VIZ — audio visualizer

Visualiseur audio 100 % navigateur, esthétique « hardware japonais minimaliste » (grilles 1px, zéro arrondi, typo mono).
Vite + React + TypeScript + Tailwind CSS. Rien n'est envoyé sur un serveur : tes fichiers restent sur ton PC.

## Fonctions

- **Charger un son** : bouton `LOAD AUDIO` ou glisser-déposer n'importe où (MP3, WAV, FLAC, OGG, M4A).
- **TEST SIGNAL** : beat synthétique à 120 BPM pour tester sans fichier.
- **A0 INSTRUMENT_DECK** (par défaut) : tableau de bord d'instruments avec waveform/loudness, scope, spectre, vectorscope, cadran de mesure (BAR), piano roll des notes détectées, autoroute de notes avec score/combo, pads de notes, graphe « most played note ». S'adapte au format 16:9, 9:16, 1:1, 4:5.
- **A1–A5** : Freq Meters, Oscilloscope, Dot Matrix, Beat Rings, Wireframe Terrain.
- **SHEET PAINT** : une image (JPG, PNG, WEBP, SVG, ou les 2 images par défaut) redessinée au rythme du son en 5 styles : Halftone, Scanline, ASCII, Blueprint Contour, Audio Brush (+ `REDRAW`).
- **Palettes** : 6 thèmes en 1 clic + 3 sélecteurs de couleur avec champ hex.
- **Export** : `EXPORT PNG` (pleine résolution, ≥1920 px) et `RECORD VIDEO` (MP4 sous Chrome/Edge récents, sinon WebM, avec le son synchronisé). L'enregistrement s'arrête tout seul à la fin du morceau.
- Raccourcis : `Espace` lecture/pause, `P` export PNG.

## Installer ou mettre à jour en une ligne (Windows)

Prérequis : **Node.js LTS** (<https://nodejs.org>). Ouvre **PowerShell** et colle :

```powershell
irm https://raw.githubusercontent.com/Kruikruik/irispoop/main/install.ps1 | iex
```

La commande :
- télécharge la dernière version depuis GitHub dans `C:\dev\irispoop` (garde tes réglages et tes `node_modules`) ;
- installe les dépendances et construit le site ;
- active le **démarrage automatique** avec Windows (en arrière-plan, sans fenêtre) ;
- ouvre **<http://localhost:4173>**.

La même commande sert aussi à réparer une installation.

## Mettre à jour depuis le site

Le bouton en haut à droite (`⟳ V·xxxxxxx`) compare ta version à la dernière sur GitHub.
Quand il affiche **UPDATE AVAILABLE** : clique dessus puis sur **INSTALL UPDATE**. Le site se met à jour, redémarre
tout seul (1 à 2 min) et la page se recharge. Si une étape échoue, l'ancienne version reste en ligne et l'erreur s'affiche.

Équivalent en ligne de commande : `cd C:\dev\irispoop` puis `npm run update`.

## Lancer à la main (développement)

```powershell
cd C:\dev\irispoop
npm install
npm run dev        # http://localhost:5173, rechargement à chaud
npm run build      # vérifie TypeScript et crée dist/
npm run preview    # sert dist/ sur http://localhost:4173
```

Depuis un autre appareil (même Wi-Fi ou Tailscale) : `http://<IP-du-PC>:4173`. Windows peut demander d'autoriser Node.js
dans le pare-feu : accepte pour les réseaux privés.

## Bon à savoir

- Garde l'onglet **visible** pendant un enregistrement vidéo : les navigateurs ralentissent l'animation des onglets en arrière-plan.
- La détection de notes et de tempo est une estimation en temps réel (FFT 8192 points + autocorrélation), elle marche mieux sur des morceaux mélodiques et rythmés.

## Arborescence

```
src/
  audio/        AudioEngine.ts (Web Audio : bandes, beats, BPM, notes), TestSignal.ts
  visualizers/  InstrumentDeck.ts + 5 presets, SheetPaint.tsx, draw.ts (helpers)
  components/   TopBar, Stage (canvas + boucle de rendu), Transport, ControlPanel, ui
  utils/        Exporter.ts (PNG / vidéo), images.ts, themes.ts
scripts/
  update.mjs              mise à jour depuis GitHub (bouton du site, npm run update, install.ps1)
  vite-update-plugin.ts   routes /__update/status et /__update/run du serveur
install.ps1               installation en une ligne
```
