import React from 'react'
import { isTauriRuntime } from '@lib/isTauri'
import { openExternalUrl } from '@lib/openExternal'
import { isAllowedExternalUrl } from '@lib/safeExternalUrl'

type ExternalLinkProps = Omit<React.ComponentPropsWithoutRef<'a'>, 'href'> & { href: string }

/**
 * Anchor for links that leave the app — the docs site, GitHub, installer downloads. On the web it
 * is an ordinary new-tab anchor. Inside the Tauri desktop shell such navigation silently no-ops
 * (BUG-27), so the click is intercepted and the URL handed to the OS browser. A caller's own
 * `onClick` still runs first, and can `preventDefault()` to suppress the hand-off.
 *
 * SEC-44: some hrefs (release notes, installer assets) come from the GitHub API via the backend.
 * A non-`https:`/`mailto:` URL — e.g. `javascript:` from a spoofed upstream response — is neither
 * rendered as a link nor handed to the OS browser; the content renders as inert text instead.
 */
const ExternalLink: React.FC<ExternalLinkProps> = ({
    href,
    target = '_blank',
    rel = 'noopener noreferrer',
    onClick,
    children,
    ...rest
}) => {
    if (!isAllowedExternalUrl(href)) {
        if (import.meta.env.DEV) {
            console.warn(`[ExternalLink] blocked non-allowlisted URL scheme: ${href}`)
        }
        return <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>{children}</span>
    }

    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event)
        if (event.defaultPrevented || !isTauriRuntime()) return
        event.preventDefault()
        void openExternalUrl(href)
    }

    return (
        <a href={href} target={target} rel={rel} onClick={handleClick} {...rest}>
            {children}
        </a>
    )
}

export default ExternalLink
