import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, userEvent, waitFor, within } from '../../../test/test-utils'

// BUG-25: clicking a receipt tile to view it full size no-ops on the desktop app because Tauri
// blocks `window.open`. On the desktop runtime the tile must open the in-app ReceiptViewerModal
// instead; on the web it keeps opening a new tab (which works there).

const mockIsTauriRuntime = vi.fn()
vi.mock('../../../desktop/isTauri', () => ({
    isTauriRuntime: () => mockIsTauriRuntime(),
}))

const fetchReceiptBlob = vi.fn()
vi.mock('../../../utils/receiptApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../utils/receiptApi')>()
    return {
        ...actual,
        fetchReceiptBlob: (id: string) => fetchReceiptBlob(id),
    }
})

const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
    default: { error: (msg: string) => toastError(msg), success: vi.fn() },
}))

import { ReceiptPreviewTile } from '../ReceiptAttachments'

const imageReceipt = {
    _id: 'rcpt-img',
    originalFilename: 'lunch.jpg',
    mimeType: 'image/jpeg',
    size: 1234,
}

const pdfReceipt = {
    _id: 'rcpt-pdf',
    originalFilename: 'invoice.pdf',
    mimeType: 'application/pdf',
    size: 4567,
}

describe('ReceiptPreviewTile - viewing a receipt full size', () => {
    const openSpy = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL

    beforeEach(() => {
        mockIsTauriRuntime.mockReset()
        fetchReceiptBlob.mockReset()
        toastError.mockReset()
        openSpy.mockReset()
        createObjectURL.mockClear()
        revokeObjectURL.mockClear()
        fetchReceiptBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))

        URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
        URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
        vi.stubGlobal('open', openSpy)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        URL.createObjectURL = originalCreate
        URL.revokeObjectURL = originalRevoke
    })

    it('web: opens the receipt in a new tab and does not render the in-app modal', async () => {
        mockIsTauriRuntime.mockReturnValue(false)
        const user = userEvent.setup()
        render(<ReceiptPreviewTile receipt={imageReceipt} />)

        await user.click(screen.getByRole('button', { name: 'lunch.jpg' }))

        await waitFor(() => expect(openSpy).toHaveBeenCalledWith('blob:mock-url', '_blank', 'noopener,noreferrer'))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('desktop: opens the in-app modal and never calls window.open', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const user = userEvent.setup()
        render(<ReceiptPreviewTile receipt={imageReceipt} />)

        await user.click(screen.getByRole('button', { name: 'lunch.jpg' }))

        const dialog = await screen.findByRole('dialog')
        expect(dialog).toHaveTextContent('lunch.jpg')
        expect(within(dialog).getByRole('img', { name: 'lunch.jpg' })).toHaveAttribute('src', 'blob:mock-url')
        expect(openSpy).not.toHaveBeenCalled()
    })

    it('desktop: renders a PDF receipt in an iframe', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const user = userEvent.setup()
        render(<ReceiptPreviewTile receipt={pdfReceipt} />)

        await user.click(screen.getByRole('button', { name: 'invoice.pdf' }))

        const dialog = await screen.findByRole('dialog')
        const frame = within(dialog).getByTitle('invoice.pdf')
        expect(frame.tagName).toBe('IFRAME')
        expect(frame).toHaveAttribute('src', 'blob:mock-url')
    })

    it('desktop: closing the modal revokes the object URL', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        const user = userEvent.setup()
        render(<ReceiptPreviewTile receipt={pdfReceipt} />)

        await user.click(screen.getByRole('button', { name: 'invoice.pdf' }))
        await screen.findByRole('dialog')

        await user.keyboard('{Escape}')

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('surfaces a toast when the receipt blob cannot be fetched', async () => {
        mockIsTauriRuntime.mockReturnValue(true)
        fetchReceiptBlob.mockRejectedValue(new Error('network'))
        const user = userEvent.setup()
        render(<ReceiptPreviewTile receipt={imageReceipt} />)

        await user.click(screen.getByRole('button', { name: 'lunch.jpg' }))

        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to open receipt'))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
})
