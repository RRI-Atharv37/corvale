/**
 * SEC-44: hrefs on the release / update surface (installer download links, "release notes",
 * asset URLs) originate from the GitHub Releases API, proxied by the backend
 * `/desktop/release-manifest` endpoint. A compromised or spoofed upstream response could carry a
 * `javascript:` or `data:` URL; `ExternalLink` renders these and, on the desktop build, hands
 * them to the OS browser. Every outbound URL is run through this allowlist first.
 *
 * The allowlist is `http:` / `https:` / `mailto:` — the schemes a link can legitimately use.
 * Everything else is refused, which is what closes the hole: `javascript:`, `data:`, `vbscript:`
 * and `file:` cannot reach an anchor or the OS browser. (`http:` stays in for local dev — the
 * docs / API origins fall back to `http://localhost` — but every shipped origin is HTTPS.)
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export const isAllowedExternalUrl = (url: string): boolean => {
    if (typeof url !== 'string' || url.length === 0) return false
    try {
        // No base: callers pass absolute URLs, so a relative or malformed string throws and is
        // refused rather than silently resolving against the app origin.
        return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
    } catch {
        return false
    }
}
