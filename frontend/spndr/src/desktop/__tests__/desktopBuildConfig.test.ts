import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Acceptance spec for D4 (desktop build sets `VITE_LOCAL_FIRST=true`).
 *
 * Before D4, `tauri.conf.json`'s `beforeDevCommand`/`beforeBuildCommand` ran the exact same
 * `npm run dev` / `npm run build` scripts as a plain web build, so both read the same `.env`
 * files and there was no mechanism forcing the desktop build to run local-first while the web
 * build stayed off pending SEC-01. This spec pins the target: Tauri drives its own `desktop`
 * Vite mode (`--mode desktop`), which layers `.env.desktop` on top of the base `.env`/
 * `.env.production` files, and only `.env.desktop` sets `VITE_LOCAL_FIRST=true`.
 */

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '../../..')

const readSource = (relativePath: string): string => fs.readFileSync(resolve(frontendRoot, relativePath), 'utf8')

describe('Desktop build sets VITE_LOCAL_FIRST=true (D4)', () => {
    it('package.json defines desktop-mode dev/build scripts using --mode desktop', () => {
        const pkg = JSON.parse(readSource('package.json'))
        expect(pkg.scripts['dev:desktop']).toContain('--mode desktop')
        expect(pkg.scripts['build:desktop']).toContain('--mode desktop')
    })

    it('tauri.conf.json runs the desktop-mode scripts, not the plain web ones', () => {
        const config = JSON.parse(readSource('src-tauri/tauri.conf.json'))
        expect(config.build.beforeDevCommand).toBe('npm run dev:desktop')
        expect(config.build.beforeBuildCommand).toBe('npm run build:desktop')
    })

    it('.env.desktop sets VITE_LOCAL_FIRST=true', () => {
        expect(fs.existsSync(resolve(frontendRoot, '.env.desktop'))).toBe(true)
        const envDesktop = readSource('.env.desktop')
        expect(envDesktop).toMatch(/^VITE_LOCAL_FIRST=true$/m)
    })

    it('the plain web env files still default VITE_LOCAL_FIRST to false', () => {
        expect(readSource('.env.example')).toMatch(/^VITE_LOCAL_FIRST=false$/m)
        expect(readSource('.env')).toMatch(/^VITE_LOCAL_FIRST=false$/m)
    })

    it('plain web scripts (dev/build) are untouched and do not force desktop mode', () => {
        const pkg = JSON.parse(readSource('package.json'))
        expect(pkg.scripts.dev).toBe('vite')
        expect(pkg.scripts.build).toBe('vite build')
    })
})
