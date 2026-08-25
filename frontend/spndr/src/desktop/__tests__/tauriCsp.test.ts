import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * G2 acceptance spec (TODO.md D2, SEC-04).
 *
 * `src-tauri/tauri.conf.json` shipped with `app.security.csp: null` - Tauri injects no policy of
 * its own into the bundled app, leaving the desktop build's HTML entirely dependent on the plain
 * `<meta>` CSP tag baked in by Vite (`index.html`, S16/SEC-18's web policy). This spec pins the
 * target state D2 must reach: an explicit, strict policy Tauri enforces on the built app.
 */

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '../../..')
const TAURI_CONF_PATH = resolve(frontendRoot, 'src-tauri/tauri.conf.json')

interface TauriConfig {
    app?: {
        security?: { csp?: string | null }
    }
}

const readTauriConfig = (): TauriConfig => JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf8'))

const readCsp = (): string => {
    const csp = readTauriConfig().app?.security?.csp
    expect(typeof csp).toBe('string')
    return csp as string
}

describe('Strict Tauri CSP (D2, SEC-04)', () => {
    it('app.security.csp is configured, not left null', () => {
        const config = readTauriConfig()
        expect(config.app?.security?.csp).not.toBeNull()
        expect(config.app?.security?.csp).toBeTruthy()
    })

    it('does not allow unsafe-eval or unsafe-inline scripts', () => {
        const csp = readCsp()
        expect(csp).not.toContain('unsafe-eval')
        expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    })

    it('does not use a bare wildcard source anywhere', () => {
        const csp = readCsp()
        for (const directive of csp.split(';')) {
            const sources = directive.trim().split(/\s+/).slice(1)
            expect(sources).not.toContain('*')
        }
    })

    it('locks down object-src, base-uri and form-action', () => {
        const csp = readCsp()
        expect(csp).toContain("object-src 'none'")
        expect(csp).toContain("base-uri 'self'")
        expect(csp).toContain("form-action 'self'")
    })

    it('restricts default-src and script-src to self', () => {
        const csp = readCsp()
        expect(csp).toMatch(/default-src[^;]*'self'/)
        expect(csp).toMatch(/script-src\s+'self'/)
    })

    it("connect-src allows the Tauri IPC bridge so invoke() calls aren't blocked", () => {
        const csp = readCsp()
        const connectSrc = csp.match(/connect-src([^;]*)/)?.[1] ?? ''
        expect(connectSrc).toContain('ipc:')
        expect(connectSrc).toContain('http://ipc.localhost')
    })

    it('connect-src only reaches remote origins over TLS, never plain http', () => {
        const csp = readCsp()
        const connectSrc = csp.match(/connect-src([^;]*)/)?.[1] ?? ''
        expect(connectSrc).not.toMatch(/\bhttp:\/\/(?!ipc\.localhost|asset\.localhost)/)
    })
})
