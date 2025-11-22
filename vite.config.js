import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Vital for Electron to load assets via file:// protocol
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext'
  }
});