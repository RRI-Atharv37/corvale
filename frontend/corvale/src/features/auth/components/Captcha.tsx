import { useEffect, useRef, useState } from 'react'

interface HCaptchaApi {
    render(
        container: HTMLElement,
        options: {
            sitekey: string
            callback: (token: string) => void
            'expired-callback'?: () => void
            'error-callback'?: () => void
        }
    ): string
}

declare global {
    interface Window {
        hcaptcha?: HCaptchaApi
    }
}

const SCRIPT_SRC = 'https://js.hcaptcha.com/1/api.js'
let scriptPromise: Promise<void> | null = null

const loadHcaptchaScript = (): Promise<void> => {
    if (window.hcaptcha) return Promise.resolve()

    if (!scriptPromise) {
        scriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script')
            script.src = SCRIPT_SRC
            script.async = true
            script.defer = true
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load hCaptcha'))
            document.head.appendChild(script)
        })
    }

    return scriptPromise
}

interface CaptchaProps {
    onVerify: (token: string) => void
    onExpire?: () => void
}

/**
 * Renders hCaptcha's explicit-render widget. Only mounted by callers when
 * `VITE_CAPTCHA_ENABLED=true` (see Signup.tsx) - that flag is also what gates the extra
 * script-src/frame-src/connect-src origins this widget needs into the CSP (vite.config.ts).
 */
const Captcha = ({ onVerify, onExpire }: CaptchaProps) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false

        loadHcaptchaScript()
            .then(() => {
                if (cancelled || !containerRef.current || !window.hcaptcha) return
                window.hcaptcha.render(containerRef.current, {
                    sitekey: import.meta.env.VITE_CAPTCHA_SITE_KEY ?? '',
                    callback: onVerify,
                    'expired-callback': onExpire,
                })
            })
            .catch(() => setError('Could not load the CAPTCHA. Please refresh and try again.'))

        return () => {
            cancelled = true
        }
    }, [onVerify, onExpire])

    if (error) {
        return <p className="text-expense text-xs pb-2.5">{error}</p>
    }

    return <div ref={containerRef} className="pb-2.5" />
}

export default Captcha
