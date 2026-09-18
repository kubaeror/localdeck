import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_API_PROXY_TARGET ?? 'http://localhost:3001';
  const basePath = env.VITE_BASE_PATH ?? '/';
  // Production builds ship hidden source maps (no `sourceMappingURL` comment).
  // Set VITE_DEBUG_SOURCEMAPS=true when a served map is needed for debugging.
  const sourcemaps = env.VITE_DEBUG_SOURCEMAPS === 'true' ? true : 'hidden';

  return {
    base: basePath,
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
      sourcemap: sourcemaps,
      target: 'es2022',
      rollupOptions: {
        output: {
          // Keep the big, rarely-changing dependencies in their own chunks so
          // route changes and service modules do not re-download Cloudscape or
          // the editor runtime. Service code itself stays in the app chunks
          // until the modules discovery switches to `import.meta.glob` lazy
          // loading (owned by the services workstream).
          manualChunks: (id: string): string | undefined => {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('ace-builds')) return 'vendor-ace';
            if (id.includes('@cloudscape-design')) return 'vendor-cloudscape';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('react-router') || id.includes('react-dom')) return 'vendor-react';
            if (/[\\/]react[\\/]/.test(id)) return 'vendor-react';
            return undefined;
          },
        },
      },
    },
    test: {
      // The suite is component-heavy: jsdom is the default so a new component
      // test does not silently run without a DOM. Pure-logic tests that need
      // Node opt in with `// @vitest-environment node`.
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['src/test/setup.ts'],
      // Persist transforms across runs: the service consoles are dynamic
      // imports, and re-transforming them on every run is the slowest part of
      // the suite.
      fsModuleCache: true,
      // Service consoles load through dynamic imports, whose first transform
      // can take seconds when the suite runs in parallel. Keep the per-test
      // budget above Testing Library's async utility timeout (5s) so a slow
      // import fails with a useful assertion instead of a bare timeout.
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
