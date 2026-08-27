import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Sprint 13.8 PWA smoke test.
//
// Service worker install / precache / true offline load can't run inside this project's
// Vitest + happy-dom harness (happy-dom has no Service Worker or Cache Storage APIs, and there's
// no e2e browser runner in this stack - see CLAUDE.md's frontend test setup). That runtime
// behavior was verified manually against a production build + `vite preview` with the origin
// server stopped entirely (stronger than devtools' "offline" checkbox): the service worker
// registered and activated, `workbox-precache-v2` contained the app shell (`index.html`,
// `manifest.webmanifest`, JS/CSS/font assets), and the app rendered fully with zero network.
//
// What *can* run here, and is a real regression guard: the static config that manual testing
// can't re-check on every change - the manifest's icon files actually exist where `vite.config.ts`
// says they do, and the Background Sync tag/message constants haven't drifted between `src/sw.ts`
// (its own Rollup build) and `src/pwa/backgroundSync.ts` (the main app bundle).

const testDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(testDir, '../../..')

const readSource = (relativePath: string): string => readFileSync(resolve(projectRoot, relativePath), 'utf-8')

describe('PWA config (Sprint 13.8)', () => {
    it('registers the VitePWA plugin with the injectManifest strategy and a prompt-based update flow', () => {
        const viteConfig = readSource('vite.config.ts')
        expect(viteConfig).toContain("strategies: 'injectManifest'")
        expect(viteConfig).toContain("filename: 'sw.ts'")
        expect(viteConfig).toContain("registerType: 'prompt'")
    })

    it('every manifest icon file referenced in vite.config.ts exists under public/', () => {
        const viteConfig = readSource('vite.config.ts')
        const iconFiles = [...viteConfig.matchAll(/src:\s*'([^']+\.png)'/g)].map((match) => match[1])

        expect(iconFiles.length).toBeGreaterThan(0)
        for (const iconFile of iconFiles) {
            expect(existsSync(resolve(projectRoot, 'public', iconFile))).toBe(true)
        }
    })

    it('apple-touch-icon referenced from index.html exists under public/', () => {
        const indexHtml = readSource('index.html')
        expect(indexHtml).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"')
        expect(existsSync(resolve(projectRoot, 'public/apple-touch-icon.png'))).toBe(true)
    })

    it('self-hosts the fonts previously loaded from the Google Fonts CDN', () => {
        const indexHtml = readSource('index.html')
        expect(indexHtml).not.toContain('fonts.googleapis.com')
        expect(indexHtml).not.toContain('fonts.gstatic.com')

        const indexCss = readSource('src/index.css')
        expect(indexCss).toContain("url('/fonts/ibm-plex-mono-400.woff2')")
        expect(indexCss).toContain("url('/fonts/ibm-plex-mono-500.woff2')")
        expect(indexCss).toContain("url('/fonts/plus-jakarta-sans-variable.woff2')")

        for (const fontFile of [
            'ibm-plex-mono-400.woff2',
            'ibm-plex-mono-500.woff2',
            'plus-jakarta-sans-variable.woff2',
        ]) {
            expect(existsSync(resolve(projectRoot, 'public/fonts', fontFile))).toBe(true)
        }
    })

    it('sw.ts precaches via the literal self.__WB_MANIFEST injection point workbox-build requires', () => {
        const swSource = readSource('src/sw.ts')
        expect(swSource).toContain('precacheAndRoute(self.__WB_MANIFEST)')
    })

    it('sw.ts registers an SPA navigation fallback that excludes API routes', () => {
        const swSource = readSource('src/sw.ts')
        expect(swSource).toContain('NavigationRoute')
        expect(swSource).toContain("denylist: [/^\\/api\\//]")
    })

    it('the Background Sync tag and message constants match between sw.ts and backgroundSync.ts (no drift)', () => {
        const swSource = readSource('src/sw.ts')
        const backgroundSyncSource = readSource('src/pwa/backgroundSync.ts')
        const constantsSource = readSource('src/pwa/constants.ts')

        expect(swSource).toContain("from './pwa/constants'")
        expect(backgroundSyncSource).toContain("from './constants'")
        expect(constantsSource).toContain("OUTBOX_SYNC_TAG = 'corvale-outbox-sync'")
        expect(constantsSource).toContain("FLUSH_OUTBOX_MESSAGE = 'CORVALE_FLUSH_OUTBOX'")
    })

    /**
     * V7.3d rename-compat shim: Background Sync registrations persist across service-worker
     * updates, so a tag registered as `spndr-outbox-sync` before the rename is still what the
     * browser fires after the new build activates - without this, every queued offline write from
     * a pre-rename session never flushes. `constants.ts` must keep exporting the legacy tag for one
     * release, and `sw.ts`'s `sync` handler must accept either tag (ROADMAP's V7 compat matrix).
     */
    it('constants.ts keeps a legacy spndr-outbox-sync tag, and sw.ts accepts it alongside the new tag', () => {
        const swSource = readSource('src/sw.ts')
        const constantsSource = readSource('src/pwa/constants.ts')

        expect(constantsSource).toContain("LEGACY_OUTBOX_SYNC_TAG = 'spndr-outbox-sync'")
        expect(swSource).toContain('LEGACY_OUTBOX_SYNC_TAG')
        expect(swSource).toMatch(/event\.tag\s*!==\s*OUTBOX_SYNC_TAG\s*&&\s*event\.tag\s*!==\s*LEGACY_OUTBOX_SYNC_TAG/)
    })

    it('React.lazy code-splits every dashboard page instead of statically importing all 25', () => {
        const appSource = readSource('src/App.tsx')
        expect(appSource).toContain("lazy(() => import('./pages/Dashboard/Home'))")
        expect(appSource).toContain("lazy(() => import('./pages/Dashboard/Reports'))")
        // Pre-auth pages (Login/Signup/ForgotPassword/ResetPassword) stay static imports -
        // they're on the critical path for every unauthenticated visitor.
        expect(appSource).toContain("import Login from './pages/auth/Login'")
    })

    it('vite.config.ts splits heavy vendor bundles out of the main chunk', () => {
        const viteConfig = readSource('vite.config.ts')
        expect(viteConfig).toContain('manualChunks')
        expect(viteConfig).toContain('recharts')
        expect(viteConfig).toContain('@sqlite.org/sqlite-wasm')
    })

    it('DOCS_URL is configurable via VITE_DOCS_URL instead of hardcoded', () => {
        const layoutSource = readSource('src/components/layouts/DashboardLayout.tsx')
        expect(layoutSource).toContain('import.meta.env.VITE_DOCS_URL')
    })

    /**
     * V6: the web build runs `VITE_LOCAL_FIRST=false`, so the "offlineReady" toast must not claim
     * the app "works offline" - that's true only of the shell, not the data. It should promise a
     * load without a connection, nothing more.
     */
    it('UpdatePrompt does not claim the (web) app "works offline"', () => {
        const promptSource = readSource('src/pwa/UpdatePrompt.tsx')
        expect(promptSource).not.toMatch(/ready to work offline|works? offline/i)
    })
})
