import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
