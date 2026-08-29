import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    fetchLiveReleaseManifest,
    getReleaseManifest,
    mergeDownloadManifest,
    parseDownloadManifestWire,
    type DownloadManifestWire,
} from '../releaseManifest'

const wire = (overrides: Partial<DownloadManifestWire> = {}): DownloadManifestWire => ({
    version: '1.2.0',
    tag: 'v1.2.0',
    publishedAt: '2026-09-01T12:00:00Z',
    assets: [
        { name: 'Corvale_1.2.0_x64_en-US.msi', url: 'https://ex/msi', sha256: 'msi256', sizeBytes: 100 },
        { name: 'Corvale_1.2.0_x64-setup.exe', url: 'https://ex/exe', sha256: 'exe256', sizeBytes: 90 },
        { name: 'Corvale_1.2.0_aarch64.dmg', url: 'https://ex/arm', sha256: 'arm256', sizeBytes: 200 },
        { name: 'Corvale_1.2.0_x64.dmg', url: 'https://ex/intel', sha256: 'intel256', sizeBytes: 210 },
        { name: 'Corvale_1.2.0_amd64.deb', url: 'https://ex/deb', sha256: 'deb256', sizeBytes: 300 },
        { name: 'Corvale-1.2.0-1.x86_64.rpm', url: 'https://ex/rpm', sha256: 'rpm256', sizeBytes: 305 },
        { name: 'Corvale_1.2.0_amd64.AppImage', url: 'https://ex/appimage', sha256: 'ai256', sizeBytes: 8000 },
    ],
    ...overrides,
})

describe('mergeDownloadManifest', () => {
    it('classifies each installer into the right platform and primary/alternate slot', () => {
        const manifest = mergeDownloadManifest(wire())

        const windows = manifest.platforms.find((p) => p.id === 'windows')!
        expect(windows.primary.url).toBe('https://ex/msi')
        expect(windows.primary.sha256).toBe('msi256')
        expect(windows.primary.sizeBytes).toBe(100)
        expect(windows.alternates.map((a) => a.url)).toEqual(['https://ex/exe'])

        const macos = manifest.platforms.find((p) => p.id === 'macos')!
        expect(macos.primary.url).toBe('https://ex/arm')
        expect(macos.alternates.map((a) => a.url)).toEqual(['https://ex/intel'])

        const linux = manifest.platforms.find((p) => p.id === 'linux')!
        expect(linux.primary.url).toBe('https://ex/deb')
        expect(linux.alternates.map((a) => a.url)).toEqual(['https://ex/rpm', 'https://ex/appimage'])
    })

    it('carries version/publishedAt through and derives the release-notes URL from the tag', () => {
        const manifest = mergeDownloadManifest(wire())
        expect(manifest.version).toBe('1.2.0')
        expect(manifest.publishedAt).toBe('2026-09-01T12:00:00Z')
        expect(manifest.releaseNotesUrl).toMatch(/\/releases\/tag\/v1\.2\.0$/)
        expect(manifest.available).toBe(true)
        expect(manifest.highlights.length).toBeGreaterThan(0)
    })

    it('prefers an explicit releaseNotesUrl from the wire manifest when present', () => {
        const manifest = mergeDownloadManifest(wire({ releaseNotesUrl: 'https://ex/notes' }))
        expect(manifest.releaseNotesUrl).toBe('https://ex/notes')
    })

    it('marks the release unavailable and leaves every slot empty when no installers match', () => {
        const manifest = mergeDownloadManifest(wire({ assets: [] }))
        expect(manifest.available).toBe(false)
        for (const platform of manifest.platforms) {
            expect(platform.primary.url).toBeNull()
            expect(platform.alternates).toEqual([])
        }
    })

    it('keeps a platform primary null (coming soon) when only an alternate format is present', () => {
        const manifest = mergeDownloadManifest(
            wire({
                assets: [
                    { name: 'Corvale_1.2.0_x64-setup.exe', url: 'https://ex/exe', sha256: null, sizeBytes: null },
                ],
            })
        )
        const windows = manifest.platforms.find((p) => p.id === 'windows')!
        expect(windows.primary.url).toBeNull()
        expect(windows.alternates.map((a) => a.url)).toEqual(['https://ex/exe'])
    })

    it('keeps the editorial system requirements from the built-in templates', () => {
        const manifest = mergeDownloadManifest(wire())
        expect(manifest.platforms.every((p) => p.systemRequirements.length > 0)).toBe(true)
    })
})

describe('parseDownloadManifestWire', () => {
    it('normalises a well-formed manifest', () => {
        const parsed = parseDownloadManifestWire(wire())
        expect(parsed.version).toBe('1.2.0')
        expect(parsed.tag).toBe('v1.2.0')
        expect(parsed.assets).toHaveLength(7)
    })

    it('defaults the tag to v<version> when it is absent', () => {
        const raw: Record<string, unknown> = { ...wire() }
        delete raw.tag
        expect(parseDownloadManifestWire(raw).tag).toBe('v1.2.0')
    })

    it('coerces missing per-asset sha256/sizeBytes to null', () => {
        const parsed = parseDownloadManifestWire({
            version: '1.0.0',
            assets: [{ name: 'x.msi', url: 'https://ex/x' }],
        })
        expect(parsed.assets[0]).toEqual({ name: 'x.msi', url: 'https://ex/x', sha256: null, sizeBytes: null })
    })

    it.each([
        null,
        42,
        {},
        { version: '' },
        { version: '1.0.0' },
        { version: '1.0.0', assets: {} },
        { version: '1.0.0', assets: [{ name: 'x.msi' }] },
        { version: '1.0.0', assets: [{ url: 'https://ex/x' }] },
    ])('rejects malformed input %j', (raw) => {
        expect(() => parseDownloadManifestWire(raw)).toThrow()
    })
})

describe('fetchLiveReleaseManifest', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const respondWith = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
        vi.fn().mockResolvedValue({
            ok: init.ok ?? true,
            status: init.status ?? 200,
            json: () => Promise.resolve(body),
        })

    it('unwraps the backend { success, data } envelope and returns the merged manifest', async () => {
        const fetchMock = respondWith({ success: true, data: wire() })
        vi.stubGlobal('fetch', fetchMock)

        const manifest = await fetchLiveReleaseManifest()

        expect(fetchMock.mock.calls[0][0]).toMatch(/\/desktop\/release-manifest$/)
        expect(manifest.version).toBe('1.2.0')
        expect(manifest.platforms.find((p) => p.id === 'windows')!.primary.url).toBe('https://ex/msi')
    })

    it('throws on a non-2xx response', async () => {
        vi.stubGlobal('fetch', respondWith({}, { ok: false, status: 502 }))
        await expect(fetchLiveReleaseManifest()).rejects.toThrow()
    })

    it('throws when the response envelope is not { success: true }', async () => {
        vi.stubGlobal('fetch', respondWith({ success: false, message: 'nope' }))
        await expect(fetchLiveReleaseManifest()).rejects.toThrow()
    })

    it('throws when the payload is malformed', async () => {
        vi.stubGlobal('fetch', respondWith({ success: true, data: { nope: true } }))
        await expect(fetchLiveReleaseManifest()).rejects.toThrow()
    })
})

describe('getReleaseManifest (built-in fallback)', () => {
    it('still returns a complete, renderable manifest for the offline / pre-fetch render', () => {
        const manifest = getReleaseManifest()
        expect(manifest.platforms).toHaveLength(3)
        expect(manifest.platforms.every((p) => p.systemRequirements.length > 0)).toBe(true)
    })
})
