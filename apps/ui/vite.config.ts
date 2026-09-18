import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_API_PROXY_TARGET ?? 'http://localhost:3001';

  return {
    plugins: [react()],
    server: {
      host: true,
      port: Number.parseInt(env.VITE_DEV_PORT ?? '5173', 10),
      // The browser always talks to the same origin: /api is proxied to the
      // LocalDeck api, so no CORS round-trip is needed during development.
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port: Number.parseInt(env.VITE_PREVIEW_PORT ?? '4173', 10),
      // The production-style smoke run (`playwright`/CI) needs the same
      // same-origin /api proxy as the dev server.
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2022',
      chunkSizeWarningLimit: 1200,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
