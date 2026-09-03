import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Acceptance spec for the desktop signing keypair and checksums (D1, SEC-05).
 *
 * `src-tauri/tauri.conf.json` today ships `plugins.updater.pubkey` as the literal placeholder
 * `"REPLACE_WITH_KEY_FROM_TAURI_SIGNER_GENERATE"` with the updater `active: true` and pointed at
 * a live GitHub Releases URL, `bundle.windows` has no certificate configuration, and
 * `bundle.macOS` doesn't exist. SEC-05 calls this a hard blocker on distributing any `.exe` —
 * Tauri refuses to install an update it can't verify, so this fails closed, but it also means
 * the update path is currently non-functional and the installer itself is unsigned.
 *
 * This spec reads the committed config and release tooling directly (no app runtime needed) and
 * pins the target state D1 must reach:
 *   - a real minisign public key in `plugins.updater.pubkey` (not the placeholder)
 *   - Windows code-signing configured under `bundle.windows`
 *   - macOS signing + notarization configured under `bundle.macOS`
 *   - a release workflow that publishes checksums alongside built artifacts
 *
 * It is expected to fail until D1 lands — that is the point of a test-first acceptance spec.
 */

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '../../../..')
const repoRoot = resolve(frontendRoot, '../..')

const TAURI_CONF_PATH = resolve(frontendRoot, 'src-tauri/tauri.conf.json')
const PLACEHOLDER_PUBKEY = 'REPLACE_WITH_KEY_FROM_TAURI_SIGNER_GENERATE'
const RELEASE_WORKFLOW_PATH = resolve(repoRoot, '.github/workflows/release.yml')

interface TauriConfig {
    bundle?: {
        windows?: { certificateThumbprint?: string; digestAlgorithm?: string; signCommand?: string }
        macOS?: { signingIdentity?: string; hardenedRuntime?: boolean }
    }
    plugins?: {
        updater?: { active?: boolean; pubkey?: string; endpoints?: string[] }
    }
}

const readTauriConfig = (): TauriConfig => JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf8'))

describe('Desktop signing verification (D1, SEC-05)', () => {
    it('the updater public key is not the committed placeholder', () => {
        const config = readTauriConfig()
        expect(config.plugins?.updater?.pubkey).toBeDefined()
        expect(config.plugins?.updater?.pubkey).not.toBe(PLACEHOLDER_PUBKEY)
    })

    it('the updater public key looks like a real minisign key, not an empty string', () => {
        const config = readTauriConfig()
        const pubkey = config.plugins?.updater?.pubkey ?? ''
        // Minisign public keys are base64; a real one is well over a placeholder-sized string.
        expect(pubkey.length).toBeGreaterThan(40)
        expect(/^[A-Za-z0-9+/=]+$/.test(pubkey)).toBe(true)
    })

    it('Windows code-signing is configured', () => {
        const config = readTauriConfig()
        const windows = config.bundle?.windows
        const hasSigningConfig = Boolean(
            windows?.certificateThumbprint || windows?.signCommand
        )
        expect(hasSigningConfig).toBe(true)
    })

    it('macOS signing and hardened runtime are configured for notarization', () => {
        const config = readTauriConfig()
        const macOS = config.bundle?.macOS
        expect(macOS?.signingIdentity).toBeTruthy()
        expect(macOS?.hardenedRuntime).toBe(true)
    })

    it('a release workflow exists that publishes checksums alongside build artifacts', () => {
        expect(fs.existsSync(RELEASE_WORKFLOW_PATH)).toBe(true)
        const contents = fs.readFileSync(RELEASE_WORKFLOW_PATH, 'utf8')
        expect(contents).toMatch(/sha256/i)
        expect(contents).toMatch(/latest\.json/)
    })
})
