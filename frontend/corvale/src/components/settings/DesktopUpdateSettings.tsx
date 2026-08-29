import React, { useEffect, useState } from 'react'
import { FiRefreshCw } from 'react-icons/fi'

import { isTauriRuntime } from '../../desktop/isTauri'
import {
    checkForDesktopUpdate,
    getInstalledVersion,
    installPendingUpdate,
} from '../../desktop/updater'
import { BRAND } from '../../utils/brand'

type CheckState =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'current' }
    | { status: 'available'; version: string }
    | { status: 'error' }

/**
 * Manual "Check for updates" (V15). `DesktopUpdatePrompt` only runs `check()` once on mount, so a
 * user who keeps the app open for days - or dismissed that prompt - can't re-trigger it without a
 * restart. This panel reuses the same signed-and-verified `checkForDesktopUpdate()` /
 * `installPendingUpdate()` path. Desktop only: renders nothing in the browser/PWA build.
 */
const DesktopUpdateSettings: React.FC = () => {
    const [installedVersion, setInstalledVersion] = useState<string | null>(null)
    const [check, setCheck] = useState<CheckState>({ status: 'idle' })
    const [installing, setInstalling] = useState(false)

    useEffect(() => {
        if (!isTauriRuntime()) return
        getInstalledVersion()
            .then(setInstalledVersion)
            .catch((error: unknown) => {
                console.error('Reading the installed version failed', error)
            })
    }, [])

    if (!isTauriRuntime()) return null

    const handleCheck = async () => {
        setCheck({ status: 'checking' })
        try {
            const result = await checkForDesktopUpdate()
            if (result.available && result.version) {
                setCheck({ status: 'available', version: result.version })
            } else {
                setCheck({ status: 'current' })
            }
        } catch (error) {
            console.error('Manual update check failed', error)
            setCheck({ status: 'error' })
        }
    }

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
        <div>
            <p className="section-label mb-3">Desktop app</p>
            <div className="rounded-lg bg-bg-secondary px-3 py-2 text-sm text-text-muted">
                {installedVersion
                    ? `You're on ${BRAND.name} ${installedVersion}`
                    : `${BRAND.name} desktop app`}
            </div>

            <div className="mt-3 space-y-2">
                {check.status === 'current' && (
                    <p className="px-3 text-sm text-text-muted">
                        You&apos;re on the latest version
                        {installedVersion ? ` (${installedVersion})` : ''}.
                    </p>
                )}
                {check.status === 'error' && (
                    <p className="px-3 text-sm text-destructive">
                        Couldn&apos;t check for updates. Try again in a moment.
                    </p>
                )}
                {check.status === 'available' && (
                    <div className="rounded-lg bg-accent-subtle px-3 py-2 text-sm text-text-primary">
                        <p className="font-medium">
                            {BRAND.name} {check.version} is available.
                        </p>
                        <button
                            type="button"
                            onClick={() => void handleInstall()}
                            disabled={installing}
                            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-60"
                        >
                            {installing ? 'Installing…' : 'Install & Restart'}
                        </button>
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => void handleCheck()}
                    disabled={check.status === 'checking'}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted hover:text-accent hover:bg-accent-subtle transition-colors disabled:opacity-50"
                >
                    <FiRefreshCw
                        size={18}
                        className={check.status === 'checking' ? 'animate-spin' : ''}
                    />
                    {check.status === 'checking' ? 'Checking…' : 'Check for updates'}
                </button>
            </div>
        </div>
    )
}

export default DesktopUpdateSettings
