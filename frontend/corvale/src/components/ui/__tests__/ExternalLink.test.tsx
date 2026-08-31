import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// BUG-27: on the desktop app an external `<a target="_blank">` click silently no-ops. ExternalLink
// keeps the plain anchor on web and, under the Tauri runtime, hands the URL to the OS browser.

const mockIsTauriRuntime = vi.fn()
vi.mock('../../../desktop/isTauri', () => ({
    isTauriRuntime: () => mockIsTauriRuntime(),
}))

const openExternalUrl = vi.fn()
vi.mock('../../../desktop/openExternal', () => ({
    openExternalUrl: (url: string) => openExternalUrl(url),
}))

import ExternalLink from '../ExternalLink'

describe('ExternalLink', () => {
    beforeEach(() => {
        mockIsTauriRuntime.mockReset()
        openExternalUrl.mockReset()
    })

    it('web: renders a new-tab anchor and does not intercept the click', async () => {
        mockIsTauriRuntime.mockReturnValue(false)
        const user = userEvent.setup()
        render(<ExternalLink href="https://example.com/docs">Docs</ExternalLink>)

        const link = screen.getByRole('link', { name: 'Docs' })
        expect(link).toHaveAttribute('href', 'https://example.com/docs')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')

        await user.click(link)
        expect(openExternalUrl).not.toHaveBeenCalled()
    })

    it('desktop: intercepts the click and hands the URL to the OS browser', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const user = userEvent.setup()
        render(<ExternalLink href="https://example.com/docs">Docs</ExternalLink>)

        await user.click(screen.getByRole('link', { name: 'Docs' }))
        expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs')
    })

    it('runs a caller-supplied onClick before the hand-off', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const onClick = vi.fn()
        const user = userEvent.setup()
        render(
            <ExternalLink href="https://example.com" onClick={onClick}>
                Go
            </ExternalLink>,
        )

        await user.click(screen.getByRole('link', { name: 'Go' }))
        expect(onClick).toHaveBeenCalledTimes(1)
        expect(openExternalUrl).toHaveBeenCalledWith('https://example.com')
    })

    it('lets a caller preventDefault to suppress the browser hand-off', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const user = userEvent.setup()
        render(
            <ExternalLink href="https://example.com" onClick={(event) => event.preventDefault()}>
                Go
            </ExternalLink>,
        )

        await user.click(screen.getByRole('link', { name: 'Go' }))
        expect(openExternalUrl).not.toHaveBeenCalled()
    })

    it('SEC-44: does not render a link or hand off a javascript: href', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const user = userEvent.setup()
        render(
            <ExternalLink href="javascript:alert(document.cookie)">Release notes</ExternalLink>,
        )

        expect(screen.queryByRole('link')).toBeNull()
        await user.click(screen.getByText('Release notes'))
        expect(openExternalUrl).not.toHaveBeenCalled()
    })

    it('SEC-44: blocks data: hrefs too', () => {
        mockIsTauriRuntime.mockReturnValue(false)
        render(<ExternalLink href="data:text/html,<b>x</b>">A</ExternalLink>)
        expect(screen.queryByRole('link')).toBeNull()
        expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('passes through className and other anchor props', () => {
        mockIsTauriRuntime.mockReturnValue(false)
        render(
            <ExternalLink href="https://example.com" className="btn-primary" aria-label="Download">
                Download
            </ExternalLink>,
        )

        const link = screen.getByRole('link', { name: 'Download' })
        expect(link).toHaveClass('btn-primary')
    })
})
