import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { updater } from './scripts/vite-update-plugin';

// base: './' → le dossier dist/ fonctionne servi depuis n'importe quel chemin
export default defineConfig({
  plugins: [react(), tailwindcss(), updater()],
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
