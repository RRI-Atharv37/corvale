import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * SEC-94 (S58): `scripts/backup-mongo.sh` used to pass the Mongo root password as a `mongodump`
 * argument, visible to every local user in the process list while the dump ran, and wrote the
 * plaintext dumps under the default umask. There is no Docker daemon or Mongo in the test
 * environment, so this pins the static script.
 */

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const SCRIPT = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'backup-mongo.sh'), 'utf8').replace(/\r\n/g, '\n')
const CODE_LINES = SCRIPT.split('\n').filter((line) => !/^\s*#/.test(line))
const CODE = CODE_LINES.join('\n')

describe('backup-mongo.sh (SEC-94, S58)', () => {
    it('sets umask 077 before it creates any file or directory', () => {
        const umaskAt = CODE.search(/^umask 077\s*$/m)
        expect(umaskAt).toBeGreaterThanOrEqual(0)
        expect(umaskAt).toBeLessThan(CODE.indexOf('mkdir'))
    })

    it('does not pass the password as an argument', () => {
        expect(CODE).not.toMatch(/--password\b/)
        expect(CODE).not.toMatch(/--uri[= ]/)
        const dumpLine = CODE_LINES.find((line) => line.includes('mongodump')) ?? ''
        expect(dumpLine).not.toMatch(/\$\{?MP\b/)
    })

    it('hands the credential to mongodump through a config file on stdin', () => {
        expect(CODE).toMatch(/mongodump[^\n]*--config[= ]\/dev\/stdin/)
        expect(CODE).toMatch(/password:/)
    })

    it('dumps the erasure ledger on its own so a restore can replay it', () => {
        expect(CODE).toMatch(/--collection[= ]erasureledgers/)
    })

    it('keeps the dump files owner-only', () => {
        expect(CODE).toMatch(/chmod 600/)
    })
})
