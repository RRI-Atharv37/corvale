import fs from 'fs'
import net from 'net'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

const CLAMAV_HOST = process.env.CLAMAV_HOST ?? '127.0.0.1'
const CLAMAV_PORT = Number(process.env.CLAMAV_PORT ?? 3310)
const CLAMAV_TIMEOUT_MS = Number(process.env.CLAMAV_TIMEOUT_MS ?? 30_000)

export type VirusScanOutcome = 'clean' | 'infected'

type ScanHandler = (filePath: string) => Promise<VirusScanOutcome>

let testScanHandler: ScanHandler | null = null

export const isVirusScanEnabled = (): boolean => process.env.VIRUS_SCAN_ENABLED === 'true'

export const isVirusScanFailClosed = (): boolean => process.env.VIRUS_SCAN_FAIL_CLOSED !== 'false'

/** Test-only hook to simulate scanner results without a live ClamAV daemon. */
export const setVirusScanHandlerForTests = (handler: ScanHandler | null): void => {
    testScanHandler = handler
}

const scanWithClamAv = (filePath: string): Promise<VirusScanOutcome> => {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: CLAMAV_HOST, port: CLAMAV_PORT })
        let response = ''
        let offset = 0
        const fileBuffer = fs.readFileSync(filePath)

        const fail = (error: Error): void => {
            socket.destroy()
            reject(error)
        }

        socket.setTimeout(CLAMAV_TIMEOUT_MS, () => {
            fail(new Error('ClamAV scan timed out'))
        })

        socket.on('error', (error) => {
            fail(error)
        })

        socket.on('data', (chunk: Buffer) => {
            response += chunk.toString('utf8')
        })

        socket.on('connect', () => {
            socket.write('zINSTREAM\0')

            const writeChunk = (): void => {
                if (offset >= fileBuffer.length) {
                    const end = Buffer.alloc(4)
                    socket.write(end)
                    return
                }

                const chunk = fileBuffer.subarray(offset, offset + 2048)
                offset += chunk.length

                const size = Buffer.alloc(4)
                size.writeUInt32BE(chunk.length, 0)
                socket.write(Buffer.concat([size, chunk]))
                writeChunk()
            }

            writeChunk()
        })

        socket.on('end', () => {
            const normalized = response.trim()

            if (normalized.endsWith('OK')) {
                resolve('clean')
                return
            }

            if (normalized.includes('FOUND')) {
                resolve('infected')
                return
            }

            reject(new Error(`Unexpected ClamAV response: ${normalized || '(empty)'}`))
        })
    })
}

export const scanUploadedFile = async (filePath: string): Promise<void> => {
    if (!isVirusScanEnabled()) {
        return
    }

    try {
        const outcome = testScanHandler
            ? await testScanHandler(filePath)
            : await scanWithClamAv(filePath)

        if (outcome === 'infected') {
            throw new CustomError(ERROR_MESSAGES.RECEIPT.VIRUS_DETECTED, 400)
        }
    } catch (error) {
        if (error instanceof CustomError) {
            throw error
        }

        if (isVirusScanFailClosed()) {
            throw new CustomError(ERROR_MESSAGES.RECEIPT.VIRUS_SCAN_FAILED, 503)
        }

        console.warn('[virus-scan] scan skipped due to error:', error)
    }
}
