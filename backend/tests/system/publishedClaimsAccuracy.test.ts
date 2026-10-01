import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

import { COOKIES_VERSION, PRIVACY_VERSION } from '@modules/users/legalVersions'

/**
 * S58 (SEC-93, SEC-94, SEC-95): wording pins for the documents that make claims the code or the
 * runbooks have to keep. Rule 5 - a published statement and the behaviour behind it move together.
 */

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const read = (...parts: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

const COOKIES = read('frontend', 'corvale', 'src', 'legal', 'cookies.md')
const PRIVACY = read('frontend', 'corvale', 'src', 'legal', 'privacy.md')
const DR_RUNBOOK = read('docs', 'developers', 'guides', 'backup-restore-runbook.md')
const BREACH_RUNBOOK = read('.project', 'breach-response-runbook.md')
const DEVICE_IDENTITY = read('frontend', 'corvale', 'src', 'platform', 'sync', 'deviceIdentity.ts')

describe('cookies.md (SEC-93, S58)', () => {
    it('lists the device id key the app really stores', () => {
        const key = /DEVICE_ID_STORAGE_KEY\s*=\s*'([^']+)'/.exec(DEVICE_IDENTITY)?.[1]
        expect(key).toBe('corvale_device_id')
        expect(COOKIES).toContain('`corvale_device_id`')
    })

    it('prints the version the server pins, so a document edit and a bump cannot drift apart', () => {
        expect(/\*\*Version:\*\* (\S+)/.exec(COOKIES)?.[1]).toBe(COOKIES_VERSION)
        expect(/\*\*Version:\*\* (\S+)/.exec(PRIVACY)?.[1]).toBe(PRIVACY_VERSION)
    })
})

describe('export completeness (SEC-93, S58)', () => {
    const oneLine = (text: string) => text.replace(/\s+/g, ' ')
    const SECTIONS = ['reconciliationSessions', 'savedReports', 'savers', 'rollovers', 'profile', 'devices', 'workspaceMemberships']
    const BACKUP_FORMAT = read('backend', 'src', 'modules', 'backup', 'backupFormat.ts')
    const LOCAL_BACKUP = read('frontend', 'corvale', 'src', 'domain', 'backup.ts')

    it('the server payload type and the desktop export list the same account-level sections', () => {
        for (const section of SECTIONS) {
            expect(BACKUP_FORMAT).toContain(`${section}`)
            expect(LOCAL_BACKUP).toContain(`'${section}'`)
        }
    })

    it('privacy.md names what the export adds and what the desktop app does offline', () => {
        const privacy = oneLine(PRIVACY)
        expect(privacy).toMatch(/reconciliation sessions, saved reports, saver history, profile, devices and workspace memberships/)
        expect(privacy).toMatch(/if it cannot reach us it tells you which it left out/)
    })

    it('the data-and-privacy page lists the same things', () => {
        const page = oneLine(read('docs', 'legal', 'your-data-and-privacy.md'))
        for (const term of ['saved reports', 'rollover history', 'profile and preferences', 'workspace memberships']) {
            expect(page).toContain(term)
        }
    })
})

describe('erasure and disaster recovery (SEC-94, S58)', () => {
    it('privacy.md discloses the erasure record and its window', () => {
        expect(PRIVACY.replace(/\s+/g, ' ')).toMatch(/record of erased accounts/i)
        expect(PRIVACY.replace(/\s+/g, ' ')).toMatch(/keyed hash/i)
    })

    it('the DR runbook re-applies erasures after a restore and saves the live ledger first', () => {
        expect(DR_RUNBOOK).toMatch(/replay:erasures/)
        expect(DR_RUNBOOK).toMatch(/erasureledgers/)
        expect(DR_RUNBOOK).toMatch(/before (you )?restor/i)
    })

    it('the DR runbook documents ERASURE_LEDGER_KEY as part of what a restore needs', () => {
        expect(DR_RUNBOOK).toContain('ERASURE_LEDGER_KEY')
    })
})

describe('breach runbook (SEC-95, S58)', () => {
    it('no longer claims that rotating JWT_SECRET logs every session out', () => {
        expect(BREACH_RUNBOOK).not.toMatch(/rotate `JWT_SECRET`[^\n]*logs out every\s+session/i)
        expect(BREACH_RUNBOOK).not.toMatch(/logs out every\s+session/i)
    })

    it('explains that refresh tokens survive a secret rotation and how to revoke them all', () => {
        expect(BREACH_RUNBOOK).toMatch(/refresh tokens? (still )?survive/i)
        expect(BREACH_RUNBOOK).toContain('revoke:sessions')
    })

    it('covers the admin plane', () => {
        for (const term of ['ADMIN_JWT_SECRET', 'AdminSession', 'ADMIN_TOTP_ENCRYPTION_KEY', 'AdminAuditLog']) {
            expect(BREACH_RUNBOOK).toContain(term)
        }
    })

    it('covers the signing and provider secrets', () => {
        for (const term of ['TAURI_SIGNING_PRIVATE_KEY', 'OFFLINE_GRANT_PRIVATE_KEY', 'webhook secret']) {
            expect(BREACH_RUNBOOK).toContain(term)
        }
    })

    it('records the DPDP Rules 2025 two-stage timeline', () => {
        expect(BREACH_RUNBOOK).toMatch(/Rule 7/)
        expect(BREACH_RUNBOOK).toMatch(/72 hours/)
        expect(BREACH_RUNBOOK).toMatch(/13 November 2025/)
        expect(BREACH_RUNBOOK).toMatch(/May 2027/)
    })
})
