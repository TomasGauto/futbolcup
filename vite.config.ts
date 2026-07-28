import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Dominio propio (elgoat.online) sirve desde la raíz: base '/' siempre.
  // Se mantiene la env var por compatibilidad, pero ya no cambia el base.
  base: '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
