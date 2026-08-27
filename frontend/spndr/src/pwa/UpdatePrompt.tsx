import React from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { FiDownloadCloud, FiX } from 'react-icons/fi'
import { BRAND } from '../utils/brand'

/**
 * Registers the service worker (Sprint 13.8) and surfaces the two states `virtual:pwa-register/react`
 * tracks: a new version waiting to activate ("needRefresh" - `registerType: 'prompt'` in
 * vite.config.ts means we must ask, not auto-reload out from under the user mid-edit) and the
 * first-install precache finishing ("offlineReady").
 */
const UpdatePrompt: React.FC = () => {
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisterError: (error) => {
            console.error('Service worker registration failed', error)
        },
    })

    if (!offlineReady && !needRefresh) return null

    const dismiss = () => {
        setOfflineReady(false)
        setNeedRefresh(false)
    }

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-xl max-w-[calc(100vw-2rem)]">
            <FiDownloadCloud size={18} className="shrink-0 text-accent" />
            <p className="text-sm text-fg">
                {needRefresh ? `A new version of ${BRAND.name} is available.` : `${BRAND.name} is ready to work offline.`}
            </p>
            {needRefresh && (
                <button
                    type="button"
                    onClick={() => void updateServiceWorker(true)}
                    className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover transition-colors"
                >
                    Reload
                </button>
            )}
            <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss"
                className="shrink-0 text-fg-muted hover:text-fg transition-colors"
            >
                <FiX size={16} />
            </button>
        </div>
    )
}

export default UpdatePrompt
