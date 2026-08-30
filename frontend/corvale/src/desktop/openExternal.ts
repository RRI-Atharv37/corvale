import { isTauriRuntime } from './isTauri'

/**
 * Opens an external URL the way the current runtime allows. Inside the Tauri desktop shell a plain
 * `<a target="_blank">` / `window.open` silently no-ops (BUG-27), so the URL is handed to the OS
 * default browser via the opener plugin. On the web it opens a new tab as usual. The plugin module
 * is imported lazily so it never lands in the web bundle.
 */
export const openExternalUrl = async (url: string): Promise<void> => {
    if (isTauriRuntime()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(url)
        return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
}
