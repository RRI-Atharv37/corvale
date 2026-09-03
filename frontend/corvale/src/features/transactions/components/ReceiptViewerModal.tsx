import React from 'react'

import Modal from '@ui/Modal'
import { isImageReceipt, isPdfReceipt } from '../receiptApi'

interface ReceiptViewerModalProps {
    open: boolean
    url: string | null
    mimeType: string
    filename: string
    onClose: () => void
}

/**
 * BUG-25: the desktop (Tauri) webview silently drops `window.open`, so a receipt opened for
 * full-size viewing has to render in-app. Images go in an `<img>`, PDFs in an `<iframe>` - both
 * point at an ephemeral `blob:` object URL, which the desktop CSP admits via `img-src blob:` and
 * `frame-src blob:` (`vite.config.ts` desktopCspPlugin + `src-tauri/tauri.conf.json`). The web
 * build keeps opening a new tab and never mounts this.
 */
const ReceiptViewerModal = ({ open, url, mimeType, filename, onClose }: ReceiptViewerModalProps) => (
    <Modal open={open && Boolean(url)} onClose={onClose} title={filename} size="xl">
        {url && isImageReceipt(mimeType) ? (
            <img
                src={url}
                alt={filename}
                className="mx-auto max-h-[75vh] w-auto object-contain"
            />
        ) : url && isPdfReceipt(mimeType) ? (
            <iframe src={url} title={filename} className="h-[75vh] w-full border-0 bg-white" />
        ) : (
            <p className="text-sm text-fg-muted">This receipt type can&rsquo;t be previewed here.</p>
        )}
    </Modal>
)

export default ReceiptViewerModal
