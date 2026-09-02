/**
 * The receipt MIME allowlist, isolated in its own dependency-free module so the `Receipt`
 * model can pin it as a schema `enum` (SEC-28) without importing `receiptUtils.ts`, which
 * imports the model back and would form a load-order cycle.
 */
export const RECEIPT_ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
] as const

export type ReceiptMimeType = (typeof RECEIPT_ALLOWED_MIME_TYPES)[number]
