#!/usr/bin/env node
// Run by .github/workflows/release.yml after `tauri-action` produces installers, so D1's
// "published SHA-256 checksums" requirement has real content to publish. Walks the two shapes
// Tauri's bundler outputs (`target/release/bundle` for a native build, `target/<triple>/release
// /bundle` when cross-compiling with --target) and hashes every installer file found.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcTauriDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetDir = join(srcTauriDir, 'target')
const INSTALLER_EXTENSIONS = new Set(['.msi', '.exe', '.dmg', '.deb', '.rpm', '.appimage'])

function findBundleDirs() {
    if (!existsSync(targetDir)) return []
    const dirs = []
    const direct = join(targetDir, 'release', 'bundle')
    if (existsSync(direct)) dirs.push(direct)
    for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const triplePath = join(targetDir, entry.name, 'release', 'bundle')
        if (existsSync(triplePath)) dirs.push(triplePath)
    }
    return dirs
}

function collectInstallers(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) collectInstallers(full, out)
        else if (INSTALLER_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(full)
    }
    return out
}

const files = findBundleDirs().flatMap((dir) => collectInstallers(dir)).sort()

if (files.length === 0) {
    console.error('generate-checksums.mjs: no installer artifacts found under target/**/release/bundle')
    process.exit(1)
}

const lines = files.map((file) => {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
    return `${hash}  ${relative(srcTauriDir, file).replace(/\\/g, '/')}`
})

const outPath = process.argv[2] ? resolve(process.argv[2]) : join(srcTauriDir, 'checksums.sha256.txt')
writeFileSync(outPath, lines.join('\n') + '\n')
console.log(lines.join('\n'))
console.log(`\nWrote ${files.length} checksum(s) to ${outPath}`)
