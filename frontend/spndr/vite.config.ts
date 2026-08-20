import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Custom sw.ts (src/sw.ts) instead of generateSW: needed for our own `sync` event
      // handler (Sprint 13.8 background sync) alongside Workbox's precache/navigateFallback.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Registration is done manually via `virtual:pwa-register/react` in src/pwa/UpdatePrompt.tsx
      // so the "new version available" prompt is a real in-app UI, not the plugin's default popup.
      injectRegister: false,
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'spndr — Know where every dollar went',
        short_name: 'spndr',
        description: 'Personal finance tracker — budgets, accounts, transactions and reports that work offline.',
        theme_color: '#14121c',
        background_color: '#14121c',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: {
        // The local-first engine (13.4-13.7) already runs entirely against dev-server assets;
        // enabling the SW in dev would fight Vite's own HMR/module graph for little benefit.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../shared/src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // Vite's dep pre-bundler rewrites this package's internal
    // `new URL('sqlite3.wasm', import.meta.url)` reference and serves the
    // dev-server's index.html fallback for it instead of the real binary
    // (surfaces as `WebAssembly.instantiate(): expected magic word ...
    // found 3c 21 64 6f` - the bytes for "<!do"). Excluding it from
    // optimization keeps the package's own wasm loading intact in dev.
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  build: {
    outDir: '../../dist/frontend',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor_react: ['react', 'react-dom', 'react-router-dom'],
          vendor_charts: ['recharts'],
          vendor_sqlite: ['@sqlite.org/sqlite-wasm'],
        },
      },
    },
  },
})
