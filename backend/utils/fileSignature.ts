import { ReceiptMimeType } from './receiptUtils'

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii')
const RIFF_TAG = Buffer.from('RIFF', 'ascii')
const WEBP_TAG = Buffer.from('WEBP', 'ascii')

const startsWith = (buffer: Buffer, signature: Buffer): boolean =>
    buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)

/**
 * Sniffs a receipt's actual bytes rather than trusting the client-declared Content-Type
 * (S14/SEC-15). Returns null when the bytes match none of the allowed receipt formats.
 */
export const detectReceiptSignature = (buffer: Buffer): ReceiptMimeType | null => {
    if (startsWith(buffer, JPEG_SIGNATURE)) {
        return 'image/jpeg'
    }
    if (startsWith(buffer, PNG_SIGNATURE)) {
        return 'image/png'
    }
    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).equals(RIFF_TAG) &&
        buffer.subarray(8, 12).equals(WEBP_TAG)
    ) {
        return 'image/webp'
    }
    if (startsWith(buffer, PDF_SIGNATURE)) {
        return 'application/pdf'
    }
    return null
}
