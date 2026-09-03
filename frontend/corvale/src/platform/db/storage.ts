export interface StorageQuota {
  usageBytes: number | null
  quotaBytes: number | null
}

/** Asks the browser not to evict this origin's OPFS-backed local DB under storage pressure. */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false
  }
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export const getStorageQuota = async (): Promise<StorageQuota> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usageBytes: null, quotaBytes: null }
  }
  try {
    const estimate = await navigator.storage.estimate()
    return { usageBytes: estimate.usage ?? null, quotaBytes: estimate.quota ?? null }
  } catch {
    return { usageBytes: null, quotaBytes: null }
  }
}
