#!/usr/bin/env node
// Run by .github/workflows/release.yml's `prepare` job to turn CHANGELOG.md into the GitHub
// Release body for the tag being published. Looks for a `## [<version>]` heading exactly
// matching the tag (with the leading `v` already stripped by the caller); falls back to
// `## [Unreleased]` with a warning if the maintainer tagged before renaming that section, since
// failing the whole release over a changelog heading slip is worse than an imprecise release body.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version) {
    console.error('Usage: extract-changelog.mjs <version>')
    process.exit(1)
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const changelog = readFileSync(resolve(repoRoot, 'CHANGELOG.md'), 'utf8')

function extractSection(heading) {
    const match = new RegExp(`^## \\[${heading.replace(/[.[\]]/g, '\\$&')}\\].*$`, 'm').exec(changelog)
    if (!match) return null
    const rest = changelog.slice(match.index + match[0].length)
    const next = /\n## \[/.exec(rest)
    return (next ? rest.slice(0, next.index) : rest).trim()
}

const section = extractSection(version)
if (section) {
    process.stdout.write(section + '\n')
    process.exit(0)
}

console.error(`No CHANGELOG.md section found for version ${version} - falling back to [Unreleased]`)
const fallback = extractSection('Unreleased')
if (!fallback) {
    console.error('No [Unreleased] section found either - CHANGELOG.md is missing both headings.')
    process.exit(1)
}
process.stdout.write(fallback + '\n')
