import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// V8 - dark color-scheme + themed scrollbars.
//
// The visible outcome (dark native scrollbars, no white flash on load, dark form controls /
// autofill / date pickers) is a browser-paint behaviour that can't run inside this project's
// Vitest + happy-dom harness. It was verified manually against `vite preview`: no white flash on
// first load, thin purple-tinted scrollbars in every scroll container, and dark <select> popups
// on Windows/Chromium.
//
// What *can* run here, and is the real regression guard: the static declarations that make the
// above work stay in place and keep their non-obvious constraints (the `@supports not` gate, the
// non-`--color-*` token namespace).

const testDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(testDir, '..', '..', '..')
const readSource = (relativePath: string): string => readFileSync(resolve(projectRoot, relativePath), 'utf-8')

describe('dark color-scheme (V8)', () => {
    it('declares the dark color scheme via <meta> before any CSS loads', () => {
        const indexHtml = readSource('index.html')
        expect(indexHtml).toContain('<meta name="color-scheme" content="dark" />')
    })

    it('backs the meta tag up with color-scheme: dark on :root', () => {
        const indexCss = readSource('src/index.css')
        expect(indexCss).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/)
    })
})

describe('themed scrollbars (V8)', () => {
    it('sets the standard scrollbar-width / scrollbar-color on html so every container inherits it', () => {
        const indexCss = readSource('src/index.css')
        expect(indexCss).toMatch(/html\s*\{[^}]*scrollbar-width:\s*thin/)
        expect(indexCss).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/)
    })

    it('names the tokens outside the --color-* namespace (Tailwind v4 would emit dead utilities otherwise)', () => {
        const indexCss = readSource('src/index.css')
        expect(indexCss).toContain('--scrollbar-thumb:')
        expect(indexCss).toContain('--scrollbar-track:')
        // No token *declared* in the --color-* namespace (a prose mention of the anti-pattern in a
        // comment is fine - match only an actual `--color-scrollbar…:` custom-property declaration).
        expect(indexCss).not.toMatch(/--color-scrollbar[\w-]*\s*:/)
    })

    it('gates the ::-webkit-scrollbar fallback behind @supports not (scrollbar-width: thin)', () => {
        const indexCss = readSource('src/index.css')
        // Chromium 121+ disables the pseudo-elements once scrollbar-width/-color is set on an
        // element - styling both unconditionally is browser-dependent. Every ::-webkit-scrollbar
        // rule must sit inside the @supports-not block.
        expect(indexCss).toContain('@supports not (scrollbar-width: thin)')

        // Nothing before the first @supports-not block may reference the pseudo-element.
        const [beforeFirstGate] = indexCss.split('@supports not (scrollbar-width: thin)')
        expect(beforeFirstGate).not.toContain('::-webkit-scrollbar')
    })

    it('never uses a `*`-prefixed webkit scrollbar selector (paint hazard on long lists)', () => {
        const indexCss = readSource('src/index.css')
        expect(indexCss).not.toMatch(/\*\s*::-webkit-scrollbar/)
    })

    it('exposes an opt-in .scroll-area class', () => {
        const indexCss = readSource('src/index.css')
        expect(indexCss).toMatch(/\.scroll-area\s*\{[^}]*scrollbar-width:\s*thin/)
    })
})
