import { fileURLToPath, URL } from 'node:url'

import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// RF1: single source for the path aliases (was duplicated in the now-deleted vitest.config.ts).
// Ordered specific-first so `@shared/x` / `@ui/x` never fall through to the bare `@` → src rule.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const ALIASES = [
  { find: '@shared', replacement: r('../../shared/src') },
  { find: '@ui', replacement: r('src/ui') },
  { find: '@lib', replacement: r('src/lib') },
  { find: '@features', replacement: r('src/features') },
  { find: '@platform', replacement: r('src/platform') },
  { find: '@domain', replacement: r('src/domain') },
  { find: '@', replacement: r('src') },
]

/**
 * hCaptcha (L9 abuse controls) needs script/frame/connect origins the strict CSP in
 * index.html (S16/SEC-18) doesn't admit by default. Only widen the policy when the build
 * actually opts in via VITE_CAPTCHA_ENABLED - every other deployment (the default) keeps
 * today's CSP byte-for-byte. Matched string replacement rather than a templating var because
 * this needs to add hCaptcha origins to several existing directives (script-src, style-src,
 * connect-src, frame-src) at once, not substitute a single value.
 */
/**
 * The Tauri desktop shell (`--mode desktop`) enforces BOTH the CSP Tauri injects from
 * `src-tauri/tauri.conf.json` AND the `<meta>` CSP in index.html - a page under two policies gets
 * the intersection of the two. The `<meta>` policy is written for the web build, so it omits the
 * two things the desktop runtime needs:
 *   - `ipc: http://ipc.localhost` in `connect-src` - Tauri v2's `invoke()` IPC goes over an
 *     internal `fetch()` to `http://ipc.localhost` (Windows/Linux) / `ipc://localhost`; without
 *     this every `invoke()` is blocked, so `TauriSqlDriver` can't open the local SQLite DB and
 *     every local-first page fails with "Failed to load local data" / "Sync failed".
 *   - `'wasm-unsafe-eval'` in `script-src` - the `@sqlite.org/sqlite-wasm` fallback driver
 *     (used if the native driver ever can't load) instantiates WebAssembly, which Chromium
 *     refuses under a bare `script-src 'self'`.
 *   - `blob:` in `img-src` - receipt thumbnails render from `URL.createObjectURL(blob)` URLs
 *     (`components/transactions/ReceiptAttachments.tsx`), which `'self'` does not cover.
 * `tauri.conf.json` carries the same widenings so both layers agree. Web builds are untouched.
 * (`frame-src 'self' blob:`, for the in-app PDF receipt viewer BUG-25 adds, is already in the
 * base `<meta>` policy - blob: frames are same-origin and page-generated - so it needs no widening
 * here; `tauri.conf.json` still has to list it explicitly since Tauri's policy is separate.)
 */
const desktopCspPlugin = (): Plugin => ({
    name: 'corvale-desktop-csp',
    transformIndexHtml: (html) =>
        html
            .replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval';")
            .replace("img-src 'self' data:;", "img-src 'self' data: blob:;")
            .replace(
                /connect-src 'self'[^;]*;/,
                (match) => `${match.slice(0, -1)} ipc: http://ipc.localhost;`
            ),
})

const captchaCspPlugin = (): Plugin => ({
    name: 'corvale-captcha-csp',
    transformIndexHtml: (html) =>
        html
            .replace("script-src 'self';", "script-src 'self' https://js.hcaptcha.com;")
            .replace(
                "style-src 'self' 'unsafe-inline';",
                "style-src 'self' 'unsafe-inline' https://newassets.hcaptcha.com;"
            )
            .replace(
                /connect-src 'self'[^;]*;/,
                (match) => `${match.slice(0, -1)} https://hcaptcha.com https://newassets.hcaptcha.com;`
            )
            .replace(
                "frame-src 'self' blob:;",
                "frame-src 'self' blob: https://newassets.hcaptcha.com;"
            ),
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const captchaEnabled = env.VITE_CAPTCHA_ENABLED === 'true'
    const isDesktop = mode === 'desktop'

    return {
  // Tauri-recommended dev-server settings (https://v2.tauri.app/start/frontend/vite/):
  // `clearScreen: false` keeps Cargo's compiler output visible instead of Vite wiping it, and
  // `strictPort: true` stops Vite from silently moving to another port if 5173 is busy - which
  // would leave `tauri.conf.json`'s `devUrl: "http://localhost:5173"` pointed at a dead server.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Without this, Vite's file watcher also crawls `src-tauri/target/` - the directory Cargo
      // is actively writing build artifacts into during `tauri dev`/`tauri build`. On Windows
      // that race trips an EBUSY error (Cargo holds a lock Vite's watcher can't read) and kills
      // the whole dev server; on Linux/macOS it's merely wasted work. Vite has no reason to watch
      // Rust build output either way.
      ignored: ['**/src-tauri/**'],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(isDesktop ? [desktopCspPlugin()] : []),
    ...(captchaEnabled ? [captchaCspPlugin()] : []),
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
        name: 'Corvale — Know where every dollar went',
        short_name: 'Corvale',
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
    alias: ALIASES,
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
  // RF1: was frontend/corvale/vitest.config.ts — merged here so the alias list lives in one place.
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['src/app/main.tsx', 'src/vite-env.d.ts', 'src/test/**'],
    },
  },
  }
})
