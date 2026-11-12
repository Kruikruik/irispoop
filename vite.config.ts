import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base: './' → le dossier dist/ fonctionne servi depuis n'importe quel chemin
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
