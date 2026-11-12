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

## Lancer le site sur ton PC (Windows)

1. Installer **Node.js LTS** : <https://nodejs.org> (bouton « LTS », installer avec les options par défaut).
2. Installer **Git** si besoin : <https://git-scm.com/download/win>.
3. Ouvrir **PowerShell** et taper :

   ```powershell
   cd $HOME\Documents
   git clone https://github.com/Kruikruik/irispoop.git
   cd irispoop
   npm install
   npm run dev
   ```

4. Ouvrir <http://localhost:5173> dans Chrome ou Edge.

Pour l'arrêter : `Ctrl + C` dans PowerShell. Pour le relancer plus tard : `cd $HOME\Documents\irispoop` puis `npm run dev`.

### Version « finale » (plus rapide)

```powershell
npm run build      # vérifie TypeScript et crée le dossier dist/
npm run preview    # sert dist/ sur http://localhost:4173
```

Le dossier `dist/` est un site statique autonome : tu peux aussi le copier sur n'importe quel serveur web (nginx, Caddy, etc.).

### Y accéder depuis un autre appareil

Les serveurs écoutent sur le réseau (`host: true`). Depuis ton téléphone ou un autre PC sur le même Wi-Fi ou via Tailscale :
`http://<IP-du-PC>:5173` (ou `:4173` pour `preview`). Windows peut demander d'autoriser Node.js dans le pare-feu : accepte pour les réseaux privés.

> Le navigateur exige souvent HTTPS pour certaines API sur une IP autre que `localhost`. La lecture et l'affichage marchent, mais si l'export vidéo est bloqué sur un autre appareil, fais l'export depuis le PC lui-même (`localhost`).

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
```
