import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Acceptance spec for SEC-66 (S34): every third-party GitHub Action must be pinned to a full
 * 40-hex commit SHA, and `ci.yml` must declare a least-privilege `permissions:` block.
 *
 * The release workflow carries the Tauri updater signing key (`TAURI_SIGNING_PRIVATE_KEY`),
 * which signs auto-updates that install on every user's machine — a mutable action ref
 * (`@v0`, `@stable`, `@v2`) there is the single total-compromise point. `ci.yml` runs
 * `npm ci` on fork PRs with no `permissions:` block, so it inherits the repo default token
 * scope.
 *
 * `actions/*` (first-party, GitHub-owned) are treated the same as third-party here — pinning
 * is all-or-nothing to be meaningful.
 */

const REPO_ROOT = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const CI = read(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'))
const RELEASE = read(path.join(REPO_ROOT, '.github', 'workflows', 'release.yml'))

/** Every `uses:` reference in a workflow file, with the ref after the last `@`. */
function usesRefs(workflow: string): { uses: string; ref: string }[] {
    return [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => {
        const value = m[1]
        const at = value.lastIndexOf('@')
        return { uses: value, ref: value.slice(at + 1) }
    })
}

const SHA_RE = /^[0-9a-f]{40}$/

for (const [name, workflow] of [
    ['ci.yml', CI],
    ['release.yml', RELEASE],
] as const) {
    describe(`${name} — actions pinned to commit SHAs (SEC-66, S34)`, () => {
        const refs = usesRefs(workflow)

        it('references at least one action', () => {
            expect(refs.length).toBeGreaterThan(0)
        })

        it.each(refs)('$uses is pinned to a 40-hex SHA', ({ ref }) => {
            expect(ref).toMatch(SHA_RE)
        })

        it('keeps a human-readable version comment next to each pin', () => {
            // every `uses:` line should carry a trailing `# vX` comment for readability
            const usesLines = workflow.split('\n').filter((l) => /uses:\s*\S+@/.test(l))
            for (const line of usesLines) {
                expect(line).toMatch(/@[0-9a-f]{40}\s*#\s*\S/)
            }
        })
    })
}

describe('ci.yml — least-privilege token (SEC-66, S34)', () => {
    it('declares a top-level permissions block', () => {
        expect(CI).toMatch(/^permissions:/m)
    })

    it('grants no more than read access to contents by default', () => {
        // the block immediately after `permissions:` must not grant write
        const block = /permissions:\s*\n((?:\s+\S.*\n)+)/.exec(CI)?.[1] ?? ''
        expect(block).toMatch(/contents:\s*read/)
        expect(block).not.toMatch(/write/)
    })
})

describe('release.yml — signing job unreachable by forks (SEC-66, S34)', () => {
    it('only triggers on tag pushes', () => {
        const header = RELEASE.slice(0, RELEASE.indexOf('jobs:'))
        expect(header).toMatch(/tags:/)
        expect(header).not.toMatch(/pull_request/)
    })

    it('does not grant blanket write at the workflow level', () => {
        const topLevel = RELEASE.slice(0, RELEASE.indexOf('jobs:'))
        const block = /permissions:\s*\n((?:\s+\S.*\n)+)/.exec(topLevel)?.[1] ?? ''
        expect(block).toMatch(/contents:\s*read/)
    })
})
