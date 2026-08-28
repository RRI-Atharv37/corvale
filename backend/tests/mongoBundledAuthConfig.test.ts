import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Acceptance spec for SEC-37 (S28): the bundled MongoDB in the shipped Docker Compose stack
 * must run with authentication enabled, and the fact that the `mongo` service is deliberately
 * not port-mapped must be recorded on the service itself.
 *
 * Before S28 the `mongo` service set no `MONGO_INITDB_ROOT_USERNAME` / `_PASSWORD` and
 * `MONGO_URI` carried no credentials — the entire financial dataset was reachable
 * unauthenticated by anything that could reach the container's network, and the only thing
 * keeping that safe (the absent `ports:` mapping) was invisible and one line from being lost.
 *
 * There is no running Docker in the test environment, so this pins the static
 * `docker-compose.yml` / `.env.example` / deployment guide instead.
 */

const REPO_ROOT = path.join(__dirname, '..', '..')
const COMPOSE = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8')
const ROOT_ENV_EXAMPLE = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8')
const BACKEND_ENV_EXAMPLE = fs.readFileSync(
    path.join(REPO_ROOT, 'backend', '.env.example'),
    'utf8'
)
const DEPLOY_DOC = fs.readFileSync(
    path.join(REPO_ROOT, 'docs', 'developers', 'deployment.md'),
    'utf8'
)

/**
 * Return the block of lines belonging to a top-level `services:` entry, by indentation:
 * every line from `  <name>:` up to (not including) the next line indented two spaces or less.
 */
function serviceBlock(source: string, name: string): string {
    const lines = source.split('\n')
    const start = lines.findIndex((l) => new RegExp(`^  ${name}:\\s*$`).test(l))
    if (start === -1) throw new Error(`service ${name} not found in docker-compose.yml`)
    const body: string[] = []
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i]
        if (line.trim() === '') {
            body.push(line)
            continue
        }
        // A non-blank line indented 0–2 spaces ends the block.
        if (/^ {0,2}\S/.test(line)) break
        body.push(line)
    }
    return body.join('\n')
}

describe('bundled MongoDB — authentication (SEC-37, S28)', () => {
    const mongo = serviceBlock(COMPOSE, 'mongo')
    const backend = serviceBlock(COMPOSE, 'backend')

    it('sets root credentials on the mongo service', () => {
        expect(mongo).toMatch(/MONGO_INITDB_ROOT_USERNAME:/)
        expect(mongo).toMatch(/MONGO_INITDB_ROOT_PASSWORD:/)
    })

    it('takes the mongo password from an interpolated variable, never a literal', () => {
        const pw = /MONGO_INITDB_ROOT_PASSWORD:\s*(.+)/.exec(mongo)?.[1]?.trim()
        expect(pw).toBeTruthy()
        expect(pw).toMatch(/^\$\{[A-Z_]+.*\}$/)
        // and it must be a hard requirement (`:?`), not a silently-empty default
        expect(pw).toMatch(/:\?/)
    })

    it('does NOT publish the mongo service to the host', () => {
        expect(mongo).not.toMatch(/^\s*ports:/m)
        // guard against the classic `27017:27017` debug edit landing anywhere in the file
        expect(COMPOSE).not.toMatch(/27017:27017/)
    })

    it('records on the mongo service that the absent ports: mapping is load-bearing', () => {
        // a comment inside the service block, mentioning ports and that it is deliberate
        expect(mongo).toMatch(/#.*ports/i)
        expect(mongo).toMatch(/deliberate|load-bearing|intentional|must not|do not add|isolation/i)
        expect(mongo).toMatch(/SEC-37/)
    })

    it('builds the backend MONGO_URI with credentials and an auth source', () => {
        const uri = /MONGO_URI:\s*(.+)/.exec(backend)?.[1]?.trim()
        expect(uri).toBeTruthy()
        expect(uri).toMatch(/^mongodb:\/\/\$\{[A-Z_]+.*\}:\$\{[A-Z_]+.*\}@mongo:27017\//)
        expect(uri).toMatch(/authSource=admin/)
    })

    it('uses the same interpolation variables on both services', () => {
        const userVars = new Set(
            [...COMPOSE.matchAll(/\$\{(MONGO_ROOT_[A-Z]+)/g)].map((m) => m[1])
        )
        expect(userVars.has('MONGO_ROOT_USERNAME')).toBe(true)
        expect(userVars.has('MONGO_ROOT_PASSWORD')).toBe(true)
    })
})

describe('bundled MongoDB — documented for self-hosters (SEC-37, S28)', () => {
    it('root .env.example declares the mongo credential vars', () => {
        expect(ROOT_ENV_EXAMPLE).toMatch(/^MONGO_ROOT_USERNAME=/m)
        expect(ROOT_ENV_EXAMPLE).toMatch(/^MONGO_ROOT_PASSWORD=/m)
    })

    it('root .env.example warns the password goes into a connection string unescaped', () => {
        expect(ROOT_ENV_EXAMPLE).toMatch(/URL-safe|url-safe|unescaped|percent-encod/i)
    })

    it('backend .env.example notes the Docker stack overrides MONGO_URI with an authenticated one', () => {
        const near = BACKEND_ENV_EXAMPLE.split('\n')
            .slice(
                Math.max(0, BACKEND_ENV_EXAMPLE.split('\n').findIndex((l) => /^MONGO_URI=/.test(l)) - 4),
                BACKEND_ENV_EXAMPLE.split('\n').findIndex((l) => /^MONGO_URI=/.test(l)) + 1
            )
            .join('\n')
        expect(near).toMatch(/auth|MONGO_ROOT|docker-compose/i)
    })

    it('deployment guide explains enabling auth on a pre-existing mongo-data volume', () => {
        expect(DEPLOY_DOC).toMatch(/MONGO_ROOT_PASSWORD/)
        expect(DEPLOY_DOC).toMatch(/existing volume|already been initialized|pre-existing|createUser/i)
    })
})
