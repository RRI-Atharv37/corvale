import axiosInstance from './axiosInstance'
import { API_PATHS } from './apiPaths'
import type { ApiResponse, Receipt } from '../types/api'
import { unwrapApiData } from './apiHelpers'

const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024

export const RECEIPT_INPUT_ACCEPT = RECEIPT_ACCEPT

export const validateReceiptFile = (file: File): string | null => {
    const allowed = RECEIPT_ACCEPT.split(',')
    if (!allowed.includes(file.type)) {
        return 'Receipt must be a JPEG, PNG, WebP image, or PDF'
    }
    if (file.size > RECEIPT_MAX_BYTES) {
        return 'Receipt file exceeds the 5 MB size limit'
    }
    return null
}

export const uploadReceipt = async (file: File): Promise<Receipt> => {
    const validationError = validateReceiptFile(file)
    if (validationError) {
        throw new Error(validationError)
    }

    const formData = new FormData()
    formData.append('receipt', file)

    const response = await axiosInstance.post<ApiResponse<Receipt>>(
        API_PATHS.RECEIPTS.UPLOAD,
        formData
    )
    return unwrapApiData(response)
}

export const fetchReceiptBlob = async (receiptId: string): Promise<Blob> => {
    return axiosInstance.get<Blob>(API_PATHS.RECEIPTS.GET_FILE(receiptId), {
        responseType: 'blob',
    })
}

export const attachReceiptToTransaction = async (
    transactionId: string,
    receiptId: string
): Promise<void> => {
    await axiosInstance.post(API_PATHS.TRANSACTIONS.ATTACH_RECEIPT(transactionId), {
        receiptId,
    })
}

export const detachReceiptFromTransaction = async (
    transactionId: string,
    receiptId: string
): Promise<void> => {
    await axiosInstance.delete(
        API_PATHS.TRANSACTIONS.DETACH_RECEIPT(transactionId, receiptId)
    )
}

export const deleteReceipt = async (receiptId: string): Promise<void> => {
    await axiosInstance.delete(API_PATHS.RECEIPTS.DELETE(receiptId))
}

export const isImageReceipt = (mimeType: string): boolean => mimeType.startsWith('image/')

export const isPdfReceipt = (mimeType: string): boolean => mimeType === 'application/pdf'
