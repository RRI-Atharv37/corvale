import { describe, it, expect } from 'vitest'
import { detectPlatform } from '../platformDetect'

describe('detectPlatform', () => {
    it('detects Windows from the platform string', () => {
        expect(
            detectPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
        ).toBe('windows')
    })

    it('detects macOS from the platform string', () => {
        expect(
            detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
        ).toBe('macos')
    })

    it('detects Linux from the platform string', () => {
        expect(
            detectPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })
        ).toBe('linux')
    })

    it('falls back to the user agent when platform is blank', () => {
        expect(detectPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('windows')
    })

    it('treats Android as unknown rather than Linux', () => {
        expect(
            detectPlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 13)' })
        ).toBe('unknown')
    })

    it('treats iOS as unknown rather than macOS', () => {
        expect(
            detectPlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })
        ).toBe('unknown')
    })

    it('returns unknown for an unrecognized platform', () => {
        expect(detectPlatform({ platform: 'FreeBSD amd64', userAgent: 'Mozilla/5.0' })).toBe('unknown')
    })
})
