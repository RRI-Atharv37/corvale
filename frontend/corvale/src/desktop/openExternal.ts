import { isTauriRuntime } from './isTauri'
import { isAllowedExternalUrl } from '../utils/safeExternalUrl'

/**
 * Opens an external URL the way the current runtime allows. Inside the Tauri desktop shell a plain
 * `<a target="_blank">` / `window.open` silently no-ops (BUG-27), so the URL is handed to the OS
 * default browser via the opener plugin. On the web it opens a new tab as usual. The plugin module
 * is imported lazily so it never lands in the web bundle.
 *
 * SEC-44: defence in depth for callers other than `ExternalLink` — a non-`https:`/`mailto:` URL
 * is refused rather than handed to `window.open` or the OS browser.
 */
export const openExternalUrl = async (url: string): Promise<void> => {
    if (!isAllowedExternalUrl(url)) {
        console.warn(`[openExternalUrl] refused non-allowlisted URL: ${url}`)
        return
    }
    if (isTauriRuntime()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(url)
        return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
}
