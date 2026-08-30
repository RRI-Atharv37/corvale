import React from 'react'
import { isTauriRuntime } from '../../desktop/isTauri'
import { openExternalUrl } from '../../desktop/openExternal'

type ExternalLinkProps = Omit<React.ComponentPropsWithoutRef<'a'>, 'href'> & { href: string }

/**
 * Anchor for links that leave the app — the docs site, GitHub, installer downloads. On the web it
 * is an ordinary new-tab anchor. Inside the Tauri desktop shell such navigation silently no-ops
 * (BUG-27), so the click is intercepted and the URL handed to the OS browser. A caller's own
 * `onClick` still runs first, and can `preventDefault()` to suppress the hand-off.
 */
const ExternalLink: React.FC<ExternalLinkProps> = ({
    href,
    target = '_blank',
    rel = 'noopener noreferrer',
    onClick,
    children,
    ...rest
}) => {
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
