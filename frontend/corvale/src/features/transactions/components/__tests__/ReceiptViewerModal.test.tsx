import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, userEvent, within } from '@/test/test-utils'
import ReceiptViewerModal from '../ReceiptViewerModal'

// BUG-25: on the desktop app `window.open` no-ops, so a receipt must be viewable in an in-app
// modal instead. This is the acceptance spec for that modal - image receipts render as <img>,
// PDF receipts render in an <iframe> (the CSP is widened to allow `blob:` in `frame-src` for the
// desktop build), and anything else gets a plain "can't preview" message rather than a blank box.

describe('ReceiptViewerModal', () => {
    it('renders nothing when closed', () => {
        render(
            <ReceiptViewerModal
                open={false}
                url="blob:mock-url"
                mimeType="image/png"
                filename="receipt.png"
                onClose={() => {}}
            />
        )
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders nothing when there is no object URL yet', () => {
        render(
            <ReceiptViewerModal
                open
                url={null}
                mimeType="image/png"
                filename="receipt.png"
                onClose={() => {}}
            />
        )
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('shows an image receipt as an <img> pointed at the object URL', () => {
        render(
            <ReceiptViewerModal
                open
                url="blob:mock-image"
                mimeType="image/jpeg"
                filename="lunch.jpg"
                onClose={() => {}}
            />
        )
        const img = screen.getByRole('img', { name: 'lunch.jpg' })
        expect(img).toHaveAttribute('src', 'blob:mock-image')
        expect(screen.getByRole('dialog')).toHaveTextContent('lunch.jpg')
    })

    it('shows a PDF receipt in an <iframe> pointed at the object URL', () => {
        render(
            <ReceiptViewerModal
                open
                url="blob:mock-pdf"
                mimeType="application/pdf"
                filename="invoice.pdf"
                onClose={() => {}}
            />
        )
        const frame = within(screen.getByRole('dialog')).getByTitle('invoice.pdf')
        expect(frame.tagName).toBe('IFRAME')
        expect(frame).toHaveAttribute('src', 'blob:mock-pdf')
    })

    it('falls back to a message for a type it cannot preview inline', () => {
        render(
            <ReceiptViewerModal
                open
                url="blob:mock-other"
                mimeType="application/octet-stream"
                filename="mystery.bin"
                onClose={() => {}}
            />
        )
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
        expect(screen.queryByTitle('mystery.bin')).not.toBeInTheDocument()
        expect(screen.getByRole('dialog')).toHaveTextContent(/previewed/i)
    })

    it('closes on Escape', async () => {
        const onClose = vi.fn()
        const user = userEvent.setup()
        render(
            <ReceiptViewerModal
                open
                url="blob:mock-image"
                mimeType="image/png"
                filename="receipt.png"
                onClose={onClose}
            />
        )
        await user.keyboard('{Escape}')
        expect(onClose).toHaveBeenCalled()
    })
})
