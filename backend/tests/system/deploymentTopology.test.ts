import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Acceptance spec for SEC-90 and SEC-91 (S57): the shipped deployment must set `TRUST_PROXY`, and
 * every runtime the pipeline builds or ships must be a supported release.
 *
 * Without `TRUST_PROXY` behind Caddy every request reaches the API from the Docker bridge gateway,
 * so each rate limiter and `ADMIN_IP_ALLOWLIST` collapse onto one address. Node 20 reached end of
 * life on 2026-04-30 and nginx 1.27 is a superseded mainline branch.
 *
 * There is no Docker daemon in the test environment, so this pins the static files.
 */

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const read = (...p: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')

const COMPOSE = read('docker-compose.yml')
const BACKEND_DOCKERFILE = read('backend', 'Dockerfile')
const FRONTEND_DOCKERFILE = read('frontend', 'corvale', 'Dockerfile')
const CI = read('.github', 'workflows', 'ci.yml')
const RELEASE = read('.github', 'workflows', 'release.yml')
const DEPENDABOT = read('.github', 'dependabot.yml')
const DEPLOY_DOC = read('docs', 'developers', 'guides', 'deployment.md')
const BACKEND_ENV_EXAMPLE = read('backend', '.env.example')

/** Node release lines that are in active or maintenance LTS as of this sprint (S57, 2026-10). */
const SUPPORTED_NODE_LTS = [24]
const MIN_NGINX_STABLE_MINOR = 30

function serviceBlock(source: string, name: string): string {
    const lines = source.split('\n')
    const start = lines.findIndex((l) => new RegExp(`^  ${name}:\\s*$`).test(l))
    if (start === -1) throw new Error(`service ${name} not found`)
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

const nonComment = (block: string) =>
    block
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n')

const fromLines = (dockerfile: string) =>
    [...dockerfile.matchAll(/^\s*FROM\s+(\S+)/gim)].map((m) => m[1])

describe('SEC-90 - the compose backend sets TRUST_PROXY', () => {
    const backend = nonComment(serviceBlock(COMPOSE, 'backend'))

    it('sets TRUST_PROXY in backend.environment', () => {
        expect(backend).toMatch(/^\s+TRUST_PROXY:\s*['"]?\d+['"]?\s*$/m)
    })

    it('trusts exactly one hop, the host reverse proxy', () => {
        expect(/^\s+TRUST_PROXY:\s*['"]?(\d+)['"]?\s*$/m.exec(backend)?.[1]).toBe('1')
    })
})

describe('SEC-90 - the deployment is documented', () => {
    it('explains TRUST_PROXY in the deployment guide', () => {
        expect(DEPLOY_DOC).toMatch(/TRUST_PROXY/)
        expect(DEPLOY_DOC).toMatch(/rate limit/i)
        expect(DEPLOY_DOC).toMatch(/ADMIN_IP_ALLOWLIST/)
    })

    it('no longer tells operators to leave TRUST_PROXY unset behind a proxy', () => {
        const section = /(?:^#.*\r?\n)+TRUST_PROXY=/m.exec(BACKEND_ENV_EXAMPLE)?.[0] ?? ''
        expect(BACKEND_ENV_EXAMPLE).toMatch(/TRUST_PROXY/)
        expect(section).toMatch(/compose/i)
    })
})

describe('SEC-91 - Dockerfiles run a supported Node LTS', () => {
    for (const [name, dockerfile] of [
        ['backend/Dockerfile', BACKEND_DOCKERFILE],
        ['frontend/corvale/Dockerfile', FRONTEND_DOCKERFILE],
    ] as const) {
        const nodeStages = fromLines(dockerfile).filter((f) => f.startsWith('node:'))

        it(`${name} has at least one Node stage`, () => {
            expect(nodeStages.length).toBeGreaterThan(0)
        })

        it.each(nodeStages)(`${name} stage %s is a supported LTS`, (image) => {
            const major = Number(/^node:(\d+)/.exec(image)?.[1])
            expect(SUPPORTED_NODE_LTS).toContain(major)
        })
    }
})

describe('SEC-91 - the frontend runtime is a current stable nginx', () => {
    const nginxImage = fromLines(FRONTEND_DOCKERFILE).find((f) => f.startsWith('nginxinc/nginx-unprivileged'))

    it('still uses the unprivileged nginx image (SEC-67)', () => {
        expect(nginxImage).toBeDefined()
    })

    it('is on an even-numbered stable branch at or above the current one', () => {
        const minor = Number(/:(?:stable-)?1\.(\d+)/.exec(nginxImage ?? '')?.[1])
        expect(Number.isNaN(minor)).toBe(false)
        expect(minor % 2).toBe(0)
        expect(minor).toBeGreaterThanOrEqual(MIN_NGINX_STABLE_MINOR)
    })
})

describe('SEC-91 - CI and release use a supported Node LTS', () => {
    for (const [name, workflow] of [
        ['ci.yml', CI],
        ['release.yml', RELEASE],
    ] as const) {
        it(`${name} pins NODE_VERSION to a supported LTS`, () => {
            const version = Number(/NODE_VERSION:\s*['"]?(\d+)/.exec(workflow)?.[1])
            expect(SUPPORTED_NODE_LTS).toContain(version)
        })
    }
})

describe('SEC-91 - images are pinned by digest', () => {
    const DIGEST = /@sha256:[0-9a-f]{64}$/

    it.each([
        ['backend/Dockerfile', BACKEND_DOCKERFILE],
        ['frontend/corvale/Dockerfile', FRONTEND_DOCKERFILE],
    ] as const)('%s pins every external FROM by digest', (_name, dockerfile) => {
        const stages = new Set(
            [...dockerfile.matchAll(/^\s*FROM\s+\S+\s+AS\s+(\S+)/gim)].map((m) => m[1].toLowerCase())
        )
        const external = fromLines(dockerfile).filter((f) => !stages.has(f.toLowerCase()))
        expect(external.length).toBeGreaterThan(0)
        for (const image of external) expect(image).toMatch(DIGEST)
    })

    it('pins every third-party image in docker-compose.yml by digest', () => {
        const images = [...nonComment(COMPOSE).matchAll(/^\s+image:\s*(\S+)/gm)].map((m) => m[1])
        expect(images.length).toBeGreaterThan(0)
        for (const image of images) expect(image).toMatch(DIGEST)
    })
})

describe('SEC-91 - Dependabot watches the container images', () => {
    it('has a docker entry for the backend Dockerfile', () => {
        expect(DEPENDABOT).toMatch(/package-ecosystem:\s*docker\s*\n\s*directory:\s*\/backend\s*$/m)
    })

    it('has a docker entry for the frontend Dockerfile', () => {
        expect(DEPENDABOT).toMatch(/package-ecosystem:\s*docker\s*\n\s*directory:\s*\/frontend\/corvale\s*$/m)
    })

    it('has a docker-compose entry for the compose images', () => {
        expect(DEPENDABOT).toMatch(/package-ecosystem:\s*docker-compose\s*\n\s*directory:\s*\/\s*$/m)
    })
})
