import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Acceptance spec for SEC-67 (S35f): both application container images must drop root and
 * declare a healthcheck.
 *
 * Before this, `backend/Dockerfile` and `frontend/corvale/Dockerfile` both ran their process
 * as root (the backend never switched off the default `root`; the frontend's official `nginx`
 * image runs its master as root) and neither declared a `HEALTHCHECK`, so an unresponsive
 * container kept receiving traffic. There is no Docker daemon in the test environment, so this
 * pins the static Dockerfiles.
 */

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const BACKEND_DOCKERFILE = read(path.join(REPO_ROOT, 'backend', 'Dockerfile'))
const FRONTEND_DOCKERFILE = read(path.join(REPO_ROOT, 'frontend', 'corvale', 'Dockerfile'))

/** The `USER` argument that is in effect at the end of the file (last non-comment `USER` line). */
function finalUser(dockerfile: string): string | null {
    const matches = [...dockerfile.matchAll(/^\s*USER\s+(\S+)/gim)]
    return matches.length ? matches[matches.length - 1][1] : null
}

describe('SEC-67 — backend container runs as non-root with a healthcheck', () => {
    it('switches to a non-root USER before the CMD', () => {
        const user = finalUser(BACKEND_DOCKERFILE)
        expect(user).not.toBeNull()
        expect(user).not.toBe('root')
        expect(user).not.toBe('0')
    })

    it('declares a HEALTHCHECK', () => {
        expect(BACKEND_DOCKERFILE).toMatch(/^\s*HEALTHCHECK\s+/im)
        expect(BACKEND_DOCKERFILE).toMatch(/\/health/)
    })

    it('gives the runtime user ownership of the writable uploads directory', () => {
        expect(BACKEND_DOCKERFILE).toMatch(/chown[^\n]*uploads/i)
    })
})

describe('SEC-67 — frontend container runs as non-root with a healthcheck', () => {
    it('runs on a non-root USER', () => {
        // Either an explicit `USER` line, or the nginx unprivileged base image (USER 101 / nginx).
        const explicit = finalUser(FRONTEND_DOCKERFILE)
        const unprivilegedBase = /FROM\s+nginxinc\/nginx-unprivileged/i.test(FRONTEND_DOCKERFILE)
        expect(unprivilegedBase || (explicit !== null && explicit !== 'root' && explicit !== '0')).toBe(
            true
        )
    })

    it('declares a HEALTHCHECK', () => {
        expect(FRONTEND_DOCKERFILE).toMatch(/^\s*HEALTHCHECK\s+/im)
    })
})
