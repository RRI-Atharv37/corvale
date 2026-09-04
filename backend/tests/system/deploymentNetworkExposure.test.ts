import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Acceptance spec for SEC-65 (S34): the shipped Docker Compose stack must publish the API and
 * the frontend on the loopback interface only. The reverse proxy is the sole public entrypoint;
 * Docker's DNAT rules bypass a host `ufw`, so binding to `0.0.0.0` here exposes the financial
 * API to the internet regardless of a host firewall.
 *
 * Before S34 both services mapped `'5000:5000'` / `'8080:80'` (all interfaces), and the
 * loopback fix lived only in `docker-compose.override.example.yml` — a file `.gitignore`
 * excludes in its real form and no documentation referenced, so a `git pull` deployment never
 * got it.
 *
 * There is no running Docker in the test environment, so this pins the static
 * `docker-compose.yml` and the deployment guide instead.
 */

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const COMPOSE = read(path.join(REPO_ROOT, 'docker-compose.yml'))
const DEPLOY_DOC = read(path.join(REPO_ROOT, 'docs', 'developers', 'guides', 'deployment.md'))

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
        if (/^ {0,2}\S/.test(line)) break
        body.push(line)
    }
    return body.join('\n')
}

/** Non-comment `ports:` mappings declared inside a service block. */
function portMappings(block: string): string[] {
    const out: string[] = []
    let inPorts = false
    for (const raw of block.split('\n')) {
        const line = raw.replace(/#.*$/, '')
        if (/^\s*ports:/.test(line)) {
            inPorts = true
            continue
        }
        if (inPorts) {
            const m = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
            if (m) {
                out.push(m[1])
                continue
            }
            if (line.trim() !== '') inPorts = false
        }
    }
    return out
}

describe('Docker Compose — public network exposure (SEC-65, S34)', () => {
    const backend = serviceBlock(COMPOSE, 'backend')
    const frontend = serviceBlock(COMPOSE, 'frontend')

    it('publishes the backend API on loopback only', () => {
        const maps = portMappings(backend)
        expect(maps.length).toBeGreaterThan(0)
        for (const m of maps) {
            expect(m).toMatch(/^127\.0\.0\.1:/)
        }
    })

    it('publishes the frontend on loopback only', () => {
        const maps = portMappings(frontend)
        expect(maps.length).toBeGreaterThan(0)
        for (const m of maps) {
            expect(m).toMatch(/^127\.0\.0\.1:/)
        }
    })

    it('never maps a service to all interfaces (bare host:container)', () => {
        const active = COMPOSE.split('\n')
            .filter((l) => !/^\s*#/.test(l))
            .join('\n')
        // a bare `- '5000:5000'` style mapping (no bind address) must not appear
        expect(active).not.toMatch(/^\s*-\s*['"]?\d+:\d+['"]?\s*$/m)
    })

    it('records on the backend service why the binding is loopback-only', () => {
        expect(backend).toMatch(/SEC-65/)
        expect(backend).toMatch(/loopback|127\.0\.0\.1|reverse proxy/i)
    })
})

describe('Docker Compose — loopback binding documented (SEC-65, S34)', () => {
    it('the deployment guide explains the loopback port binding and the override', () => {
        expect(DEPLOY_DOC).toMatch(/127\.0\.0\.1/)
        expect(DEPLOY_DOC).toMatch(/docker-compose\.override/)
    })

    it('the deployment guide warns that Docker bypasses a host firewall (ufw)', () => {
        expect(DEPLOY_DOC).toMatch(/ufw|iptables|DNAT|bypass/i)
    })
})
