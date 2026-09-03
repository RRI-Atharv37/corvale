import { beforeEach, describe, expect, it, vi } from 'vitest'

// BUG-27: external URLs must reach the OS default browser. On web that's `window.open`; inside the
// Tauri webview `window.open` no-ops, so it has to route through the opener plugin instead.

const mockIsTauriRuntime = vi.fn()
vi.mock('../isTauri', () => ({
    isTauriRuntime: () => mockIsTauriRuntime(),
}))

const openUrl = vi.fn()
vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: (url: string) => openUrl(url),
}))

import { openExternalUrl } from '../openExternal'

describe('openExternalUrl', () => {
    beforeEach(() => {
        mockIsTauriRuntime.mockReset()
        openUrl.mockReset()
    })

    it('web: opens a new tab via window.open and never touches the opener plugin', async () => {
        mockIsTauriRuntime.mockReturnValue(false)
        const openSpy = vi.fn()
        vi.stubGlobal('open', openSpy)

        await openExternalUrl('https://corvale.app/docs')

        expect(openSpy).toHaveBeenCalledWith('https://corvale.app/docs', '_blank', 'noopener,noreferrer')
        expect(openUrl).not.toHaveBeenCalled()
        vi.unstubAllGlobals()
    })

    it('SEC-44: refuses a non-allowlisted scheme on both runtimes', async () => {
        const openSpy = vi.fn()
        vi.stubGlobal('open', openSpy)

        mockIsTauriRuntime.mockReturnValue(false)
        await openExternalUrl('javascript:alert(1)')
        mockIsTauriRuntime.mockReturnValue(true)
        await openExternalUrl('data:text/html,x')

        expect(openSpy).not.toHaveBeenCalled()
        expect(openUrl).not.toHaveBeenCalled()
        vi.unstubAllGlobals()
    })

    it('desktop: routes through the opener plugin, not window.open', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const openSpy = vi.fn()
        vi.stubGlobal('open', openSpy)

        await openExternalUrl('https://corvale.app/docs')

        expect(openUrl).toHaveBeenCalledWith('https://corvale.app/docs')
        expect(openSpy).not.toHaveBeenCalled()
        vi.unstubAllGlobals()
    })
})
