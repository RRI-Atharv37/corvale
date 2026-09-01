import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BUG-27: external links (`Docs` in the dashboard header, the GitHub link, the `/download`
 * installer links) are dead in the Tauri desktop app — the webview no-ops `target="_blank"`. The
 * fix wires the `opener` plugin and routes every external link through `<ExternalLink>`. This spec
 * pins that wiring so a future refactor can't quietly reintroduce a raw `<a target="_blank">` for
 * an external URL.
 */

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '../../..')
const readSource = (relativePath: string): string => fs.readFileSync(resolve(frontendRoot, relativePath), 'utf8')

describe('BUG-27: opener plugin is wired for external links', () => {
    it('Cargo.toml depends on tauri-plugin-opener', () => {
        expect(readSource('src-tauri/Cargo.toml')).toMatch(/^tauri-plugin-opener\s*=/m)
    })

    it('lib.rs registers the opener plugin', () => {
        expect(readSource('src-tauri/src/lib.rs')).toContain('tauri_plugin_opener::init()')
    })

    it('the main window capability grants URL-opening but not the unused reveal-in-dir permission', () => {
        const capability = JSON.parse(readSource('src-tauri/capabilities/default.json'))
        expect(capability.permissions).toContain('opener:allow-open-url')
        expect(capability.permissions).toContain('opener:allow-default-urls')
        expect(capability.permissions).not.toContain('opener:allow-reveal-item-in-dir')
    })

    it('the JS guest bindings are a dependency', () => {
        const pkg = JSON.parse(readSource('package.json'))
        expect(pkg.dependencies['@tauri-apps/plugin-opener']).toBeTruthy()
    })
})

describe('BUG-27: external link call sites use <ExternalLink>', () => {
    const externalAnchorRe = /<a\b[^>]*\btarget=["']_blank["']/

    it('the dashboard header "Docs" link goes through ExternalLink', () => {
        const source = readSource('src/components/layouts/DashboardLayout.tsx')
        expect(source).toContain('ExternalLink')
        expect(source).not.toMatch(externalAnchorRe)
    })

    it('the landing-page GitHub link goes through ExternalLink', () => {
        const source = readSource('src/pages/Landing.tsx')
        expect(source).toContain('ExternalLink')
        expect(source).not.toMatch(externalAnchorRe)
    })

    it('the /download page links go through ExternalLink', () => {
        const source = readSource('src/pages/Download.tsx')
        expect(source).toContain('ExternalLink')
        expect(source).not.toMatch(externalAnchorRe)
    })
})
