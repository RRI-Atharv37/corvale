import fs from 'fs'

import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
    type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * L3 / SEC-23: receipts move off ephemeral local disk onto S3-compatible object storage.
 * Mirrors the `mailService.ts` seam (`setMailTransport`) — env-driven selection in
 * production, an injectable fake in tests so no real network call is ever made.
 */
export interface ReceiptObjectStorage {
    putObject(key: string, sourceFilePath: string, contentType: string): Promise<void>
    /** Full object bytes — used by the ZIP backup export (SEC-53), which cannot redirect. */
    getObjectBuffer(key: string): Promise<Buffer>
    getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
    deleteObject(key: string): Promise<void>
}

// Short-lived, per SEC-23's recommendation — a few minutes, not hours.
export const RECEIPT_SIGNED_URL_EXPIRY_SECONDS = 5 * 60

let testAdapter: ReceiptObjectStorage | null = null

/** Test-only hook to inject a fake adapter without a live S3-compatible connection. */
export const setReceiptObjectStorage = (adapter: ReceiptObjectStorage | null): void => {
    testAdapter = adapter
}

export const isObjectStorageConfigured = (): boolean =>
    process.env.RECEIPT_STORAGE_DRIVER === 's3'

export const receiptObjectKey = (userId: string, storedFilename: string): string =>
    `${userId}/${storedFilename}`

const buildS3Adapter = (): ReceiptObjectStorage => {
    const bucket = process.env.RECEIPT_S3_BUCKET
    if (!bucket) {
        throw new Error('RECEIPT_S3_BUCKET is required when RECEIPT_STORAGE_DRIVER=s3')
    }

    const hasExplicitCredentials =
        process.env.RECEIPT_S3_ACCESS_KEY_ID && process.env.RECEIPT_S3_SECRET_ACCESS_KEY

    const client = new S3Client({
        region: process.env.RECEIPT_S3_REGION ?? 'us-east-1',
        endpoint: process.env.RECEIPT_S3_ENDPOINT || undefined,
        forcePathStyle: process.env.RECEIPT_S3_FORCE_PATH_STYLE === 'true',
        credentials: hasExplicitCredentials
            ? {
                  accessKeyId: process.env.RECEIPT_S3_ACCESS_KEY_ID as string,
                  secretAccessKey: process.env.RECEIPT_S3_SECRET_ACCESS_KEY as string,
              }
            : undefined,
    })

    return {
        putObject: async (key, sourceFilePath, contentType) => {
            await client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: fs.createReadStream(sourceFilePath),
                    ContentType: contentType,
                    ContentLength: fs.statSync(sourceFilePath).size,
                    // Server-side encryption at rest, per SEC-23's recommendation.
                    ServerSideEncryption: 'AES256',
                })
            )
        },
        getObjectBuffer: async (key) => {
            const response: GetObjectCommandOutput = await client.send(
                new GetObjectCommand({ Bucket: bucket, Key: key })
            )
            if (!response.Body) {
                throw new Error(`Object storage returned an empty body for ${key}`)
            }
            const bytes = await response.Body.transformToByteArray()
            return Buffer.from(bytes)
        },
        getSignedDownloadUrl: async (key, expiresInSeconds) =>
            getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
                expiresIn: expiresInSeconds,
            }),
        deleteObject: async (key) => {
            await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        },
    }
}

let cachedProdAdapter: ReceiptObjectStorage | null = null

const getAdapter = (): ReceiptObjectStorage => {
    if (testAdapter) {
        return testAdapter
    }
    if (!cachedProdAdapter) {
        cachedProdAdapter = buildS3Adapter()
    }
    return cachedProdAdapter
}

export const putReceiptObject = (
    key: string,
    sourceFilePath: string,
    contentType: string
): Promise<void> => getAdapter().putObject(key, sourceFilePath, contentType)

export const getReceiptObjectBuffer = (key: string): Promise<Buffer> =>
    getAdapter().getObjectBuffer(key)

export const getReceiptSignedDownloadUrl = (
    key: string,
    expiresInSeconds: number = RECEIPT_SIGNED_URL_EXPIRY_SECONDS
): Promise<string> => getAdapter().getSignedDownloadUrl(key, expiresInSeconds)

export const deleteReceiptObject = (key: string): Promise<void> => getAdapter().deleteObject(key)
