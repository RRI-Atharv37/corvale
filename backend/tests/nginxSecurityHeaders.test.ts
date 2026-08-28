import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Acceptance spec for SEC-31 (S24): the shipped frontend web server must send real HTTP
 * security headers, not rely on the `<meta http-equiv>` CSP in index.html.
 *
 * `frame-ancestors` has no effect from a `<meta>` tag (CSP spec), so before S24 the deployed
 * app — `frontend/corvale/Dockerfile` + `frontend/corvale/nginx.conf` — was framable, exposing
 * one-click destructive controls (Delete Account, Logout all sessions, workspace Remove member,
 * invite accept) to clickjacking.
 *
 * This spec pins the static nginx config, since there is no running nginx in the test
 * environment. It asserts the header set is present, that it is declared with `always` (so it
 * also covers error responses such as the 404 branch), and that any `location` block which
 * declares its own `add_header` re-declares the security headers too — nginx's `add_header` is
 * NOT inherited into a block that sets any header of its own, which is the classic footgun here.
 */

const NGINX_CONF = path.join(__dirname, '..', '..', 'frontend', 'corvale', 'nginx.conf')
const conf = fs.readFileSync(NGINX_CONF, 'utf8')

/** Extract the body of every `location ... { ... }` block (brace-balanced). */
function locationBlocks(source: string): string[] {
    const blocks: string[] = []
    const re = /location\s+[^{]+\{/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source))) {
        let depth = 1
        let i = re.lastIndex
        for (; i < source.length && depth > 0; i++) {
            if (source[i] === '{') depth++
            else if (source[i] === '}') depth--
        }
        blocks.push(source.slice(re.lastIndex, i - 1))
    }
    return blocks
}

describe('nginx security headers (SEC-31, S24)', () => {
    it('sends X-Frame-Options: DENY', () => {
        expect(conf).toMatch(/add_header\s+X-Frame-Options\s+"?DENY"?\s+always\s*;/i)
    })

    it('sends X-Content-Type-Options: nosniff', () => {
        expect(conf).toMatch(/add_header\s+X-Content-Type-Options\s+"?nosniff"?\s+always\s*;/i)
    })

    it('sends Referrer-Policy: strict-origin-when-cross-origin', () => {
        expect(conf).toMatch(
            /add_header\s+Referrer-Policy\s+"?strict-origin-when-cross-origin"?\s+always\s*;/i
        )
    })

    it('sends a Content-Security-Policy header carrying frame-ancestors (what a <meta> tag cannot)', () => {
        const cspLines = conf
            .split('\n')
            .filter((l) => /add_header\s+Content-Security-Policy/i.test(l))
        expect(cspLines.length).toBeGreaterThan(0)
        for (const line of cspLines) {
            expect(line).toMatch(/frame-ancestors\s+'none'/)
            expect(line).toMatch(/\salways\s*;/)
        }
    })

    it('sends Strict-Transport-Security with a max-age of at least one year', () => {
        const hstsMatch = conf.match(
            /add_header\s+Strict-Transport-Security\s+"([^"]+)"\s+always\s*;/i
        )
        expect(hstsMatch).not.toBeNull()
        const maxAge = Number(/max-age=(\d+)/.exec(hstsMatch![1])?.[1] ?? '0')
        expect(maxAge).toBeGreaterThanOrEqual(31536000)
    })

    it('re-declares the security headers in every location block that sets its own add_header', () => {
        const blocksWithOwnHeader = locationBlocks(conf).filter((b) => /add_header/i.test(b))
        expect(blocksWithOwnHeader.length).toBeGreaterThan(0)
        for (const block of blocksWithOwnHeader) {
            expect(block).toMatch(/X-Frame-Options/i)
            expect(block).toMatch(/X-Content-Type-Options/i)
            expect(block).toMatch(/Content-Security-Policy/i)
            expect(block).toMatch(/Referrer-Policy/i)
            expect(block).toMatch(/Strict-Transport-Security/i)
        }
    })

    it('redirects HTTP to HTTPS when it can tell the external scheme was cleartext', () => {
        // Behind the required TLS terminator (Caddy, per V10) this is belt-and-braces — Caddy
        // already 301s http->https before nginx sees the request — but it must be present so a
        // misconfigured proxy that forwards cleartext still upgrades.
        expect(conf).toMatch(/\$http_x_forwarded_proto/)
        expect(conf).toMatch(/return\s+301\s+https:\/\//)
    })
})

describe('deployment guide — TLS is required, not optional (SEC-31, S24)', () => {
    const DEPLOY_DOC = path.join(__dirname, '..', '..', 'docs', 'developers', 'deployment.md')
    const doc = fs.readFileSync(DEPLOY_DOC, 'utf8')

    it('states that a TLS terminator is required for any internet-facing deployment', () => {
        expect(doc).toMatch(/required/i)
        expect(doc).toMatch(/HTTP→HTTPS|HTTP->HTTPS|HTTP to HTTPS/i)
    })
})
