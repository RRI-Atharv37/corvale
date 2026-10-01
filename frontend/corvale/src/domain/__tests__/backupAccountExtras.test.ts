import { describe, expect, it, vi } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import type { LocalDb } from '@platform/db/LocalDb'
import {
  ACCOUNT_EXTRA_SECTIONS,
  exportLocalBackup,
  exportLocalBackupWithExtras,
  parseLocalBackupPayload,
  previewLocalRestore,
  type AccountExtras,
} from '../backup'

/**
 * SEC-93 - the desktop export is built from local SQLite tables, which hold none of the account-level
 * data (reconciliation sessions, saved reports, saver and rollover history, profile, devices,
 * workspace memberships). It fetches them from the API when online and says plainly what it could not
 * include when offline, so the file never looks complete when it is not.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const EXTRAS: AccountExtras = {
  reconciliationSessions: [{ id: 'rs1', statementBalance: 100000 }],
  savedReports: [{ id: 'sr1', name: 'Monthly spend' }],
  savers: [{ id: 'sv1', saverAmount: 5000 }],
  rollovers: [{ id: 'ro1', pushoverAmount: 700 }],
  profile: { email: 'a@example.com', fullName: 'A' },
  devices: [{ id: 'd1', deviceId: 'device-abc' }],
  workspaceMemberships: [{ id: 'w1', name: 'Household', role: 'owner' }],
}

describe('exportLocalBackupWithExtras (SEC-93)', () => {
  it('merges the fetched sections into the local export', async () => {
    const db = await freshDb()
    const fetchExtras = vi.fn().mockResolvedValue(EXTRAS)

    const payload = await exportLocalBackupWithExtras(db, { workspaceId: null }, fetchExtras)

    expect(fetchExtras).toHaveBeenCalledWith(null)
    for (const section of ACCOUNT_EXTRA_SECTIONS) {
      expect(payload[section]).toEqual(EXTRAS[section])
    }
    expect(payload.omittedSections).toBeUndefined()
    expect(payload.accounts).toEqual([])
  })

  it('asks for the active workspace\'s sections when exporting a workspace', async () => {
    const db = await freshDb()
    const fetchExtras = vi.fn().mockResolvedValue({ ...EXTRAS, profile: null, savers: [] })

    const payload = await exportLocalBackupWithExtras(db, { workspaceId: 'ws-1' }, fetchExtras)

    expect(fetchExtras).toHaveBeenCalledWith('ws-1')
    expect(payload.profile).toBeNull()
  })

  it('still exports the local data and lists every section it left out when the fetch fails', async () => {
    const db = await freshDb()
    const fetchExtras = vi.fn().mockRejectedValue(new Error('Network Error'))

    const payload = await exportLocalBackupWithExtras(db, { workspaceId: null }, fetchExtras)

    expect(payload.omittedSections).toEqual([...ACCOUNT_EXTRA_SECTIONS])
    for (const section of ACCOUNT_EXTRA_SECTIONS) expect(payload[section]).toBeUndefined()
    expect(payload.version).toBe(1)
    expect(Array.isArray(payload.transactions)).toBe(true)
  })

  it('leaves the plain local export unchanged', async () => {
    const db = await freshDb()

    const payload = await exportLocalBackup(db, { workspaceId: null })

    expect(payload.omittedSections).toBeUndefined()
    for (const section of ACCOUNT_EXTRA_SECTIONS) expect(payload[section]).toBeUndefined()
  })
})

describe('local restore and the account-level sections (SEC-93)', () => {
  it('warns that a file carrying them does not restore them', async () => {
    const db = await freshDb()
    const payload = await exportLocalBackupWithExtras(db, { workspaceId: null }, async () => EXTRAS)

    const preview = previewLocalRestore(db, payload, null)

    expect(preview.valid).toBe(true)
    expect(preview.warnings.join(' ')).toMatch(/not restored/i)
  })

  it('does not warn about a file without them', async () => {
    const db = await freshDb()
    const payload = await exportLocalBackup(db, { workspaceId: null })

    expect(previewLocalRestore(db, payload, null).warnings.join(' ')).not.toMatch(/not restored/i)
  })

  it('does not warn about empty sections', async () => {
    const db = await freshDb()
    const empty: AccountExtras = {
      reconciliationSessions: [],
      savedReports: [],
      savers: [],
      rollovers: [],
      profile: null,
      devices: [],
      workspaceMemberships: [],
    }
    const payload = await exportLocalBackupWithExtras(db, { workspaceId: 'ws-1' }, async () => empty)

    expect(previewLocalRestore(db, payload, 'ws-1').warnings.join(' ')).not.toMatch(/not restored/i)
  })

  it('accepts an older file with none of the sections', async () => {
    const db = await freshDb()
    const payload = await exportLocalBackup(db, { workspaceId: null })

    expect(() => parseLocalBackupPayload(JSON.parse(JSON.stringify(payload)))).not.toThrow()
  })

  it('rejects a malformed section instead of trusting it', async () => {
    const db = await freshDb()
    const payload = JSON.parse(JSON.stringify(await exportLocalBackup(db, { workspaceId: null })))
    payload.reconciliationSessions = 'nope'

    expect(() => parseLocalBackupPayload(payload)).toThrow(/not a valid Corvale backup/)
  })
})
