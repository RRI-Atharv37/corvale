import React, { useEffect, useState } from 'react'
import { FiDownloadCloud, FiX } from 'react-icons/fi'
import { isTauriRuntime } from '@lib/isTauri'
import { checkForDesktopUpdate, installPendingUpdate } from './updater'
import { BRAND } from '@lib/brand'

/**
 * Desktop counterpart to `pwa/UpdatePrompt.tsx` - checks the Tauri updater endpoint once on mount
 * and offers to download, install and relaunch. Renders nothing outside the Tauri shell, so it's
 * safe to mount unconditionally alongside the PWA prompt (see `App.tsx`, which picks one or the
 * other based on `isTauriRuntime()`).
 */
const DesktopUpdatePrompt: React.FC = () => {
  const [available, setAvailable] = useState(false)
  const [version, setVersion] = useState<string | undefined>()
  const [installing, setInstalling] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isTauriRuntime()) return
    checkForDesktopUpdate()
      .then((result) => {
        if (result.available) {
          setAvailable(true)
          setVersion(result.version)
        }
      })
      .catch((error: unknown) => {
        console.error('Desktop update check failed', error)
      })
  }, [])

  if (!available || dismissed) return null

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await installPendingUpdate()
    } catch (error) {
      console.error('Desktop update install failed', error)
      setInstalling(false)
    }
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-xl max-w-[calc(100vw-2rem)]">
      <FiDownloadCloud size={18} className="shrink-0 text-accent" />
      <p className="text-sm text-fg">
        {version ? `${BRAND.name} ${version} is available.` : `A new version of ${BRAND.name} is available.`}
      </p>
      <button
        type="button"
        onClick={() => void handleInstall()}
        disabled={installing}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-60"
      >
        {installing ? 'Installing…' : 'Install & Restart'}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-fg-muted hover:text-fg transition-colors"
      >
        <FiX size={16} />
      </button>
    </div>
  )
}

export default DesktopUpdatePrompt
