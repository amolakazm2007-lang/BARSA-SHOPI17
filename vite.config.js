import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // Production Android packages do not need source maps. Keeping them out of
    // dist avoids shipping diagnostic source payloads in every APK while
    // leaving runtime code, models and output quality completely unchanged.
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@ffmpeg') || id.includes('node_modules/mediabunny')) return 'media-runtime';
          if (id.includes('node_modules/onnxruntime-web')) return 'ai-runtime';
          if (id.includes('/src/engine/')) return 'barsa-engines';
          if (id.includes('/src/ui/')) return 'barsa-ui';
          if (id.includes('/src/platform/')) return 'barsa-platform';
        },
      },
    },
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
