import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopCspPlugin, captchaCspPlugin } from '../../../../vite.config'

/**
 * Regression spec for BUG-40: on a desktop + captcha-enabled build, `desktopCspPlugin` runs
 * before `captchaCspPlugin` in the `plugins` array and rewrites index.html's base
 * "script-src 'self';" to "script-src 'self' 'wasm-unsafe-eval';" before the captcha plugin
 * ever sees it. `captchaCspPlugin` used to match that directive with a literal string, so it
 * silently no-op'd once the text no longer matched exactly - hCaptcha's script origin never
 * made it into the built index.html, even with VITE_CAPTCHA_ENABLED=true. Fixed by switching
 * that replace to a regex, mirroring how connect-src was already handled.
 */

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '../../../..')
const baseIndexHtml = fs.readFileSync(resolve(frontendRoot, 'index.html'), 'utf8')

const runTransform = (plugin: ReturnType<typeof desktopCspPlugin>, html: string): string => {
    const handler = plugin.transformIndexHtml as (html: string) => string
    return handler(html)
}

describe('desktop + hCaptcha CSP composition in index.html (BUG-40)', () => {
    it('admits both wasm-unsafe-eval and the hCaptcha script origin when both plugins run', () => {
        let html = runTransform(desktopCspPlugin(), baseIndexHtml)
        html = runTransform(captchaCspPlugin(), html)

        const scriptSrc = html.match(/script-src([^;]*)/)?.[1] ?? ''
        expect(scriptSrc).toContain("'wasm-unsafe-eval'")
        expect(scriptSrc).toContain('https://js.hcaptcha.com')
    })

    it('still admits the hCaptcha script origin when captcha runs without the desktop plugin (web build)', () => {
        const html = runTransform(captchaCspPlugin(), baseIndexHtml)
        const scriptSrc = html.match(/script-src([^;]*)/)?.[1] ?? ''
        expect(scriptSrc).toContain('https://js.hcaptcha.com')
        expect(scriptSrc).not.toContain("'wasm-unsafe-eval'")
    })
})
