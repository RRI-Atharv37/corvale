import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../safeExternalUrl'

// SEC-44: release/update hrefs come from the GitHub API (proxied by the backend). A spoofed
// upstream response could carry a `javascript:` / `data:` URL; only https + mailto are rendered.

describe('isAllowedExternalUrl', () => {
    it('allows http, https and mailto', () => {
        expect(isAllowedExternalUrl('https://github.com/RRI-Atharv37/corvale/releases/latest')).toBe(true)
        expect(isAllowedExternalUrl('https://api.corvale.app/downloads/Corvale_1.0.2_x64.dmg')).toBe(true)
        expect(isAllowedExternalUrl('http://localhost:5174/desktop/overview')).toBe(true)
        expect(isAllowedExternalUrl('mailto:support@corvale.app')).toBe(true)
    })

    it('rejects javascript:, data:, and other executable schemes', () => {
        expect(isAllowedExternalUrl('javascript:alert(document.cookie)')).toBe(false)
        expect(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
        expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
        expect(isAllowedExternalUrl('vbscript:msgbox(1)')).toBe(false)
    })

    it('rejects malformed or empty input', () => {
        expect(isAllowedExternalUrl('')).toBe(false)
        expect(isAllowedExternalUrl('   ')).toBe(false)
        expect(isAllowedExternalUrl('not a url')).toBe(false)
        // @ts-expect-error — guarding the non-string case
        expect(isAllowedExternalUrl(null)).toBe(false)
    })
})
