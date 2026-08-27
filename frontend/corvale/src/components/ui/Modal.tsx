import React, { ReactNode, useEffect, useRef } from 'react'
import { IoClose } from 'react-icons/io5'

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
    open: boolean
    onClose: () => void
    title: string
    children: ReactNode
    size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
}

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, size = 'md' }) => {
    const dialogRef = useRef<HTMLDivElement>(null)
    const previouslyFocusedRef = useRef<HTMLElement | null>(null)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    useEffect(() => {
        if (!open) return

        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCloseRef.current()
                return
            }

            if (e.key !== 'Tab' || !dialogRef.current) return

            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
            )
            if (focusable.length === 0) {
                e.preventDefault()
                return
            }

            const first = focusable[0]
            const last = focusable[focusable.length - 1]

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first.focus()
            }
        }

        document.addEventListener('keydown', handleKeydown)
        document.body.style.overflow = 'hidden'

        previouslyFocusedRef.current = document.activeElement as HTMLElement | null
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ;(focusable && focusable[0] ? focusable[0] : dialogRef.current)?.focus()

        return () => {
            document.removeEventListener('keydown', handleKeydown)
            document.body.style.overflow = ''
            previouslyFocusedRef.current?.focus()
        }
        // Deliberately excludes `onClose` - it's read via `onCloseRef` so this effect only
        // re-runs on open/close transitions, not on every re-render of a caller that passes a
        // non-memoized `onClose` (the common case, e.g. a controlled form re-rendering on every
        // keystroke). Re-running per keystroke would steal focus back into the dialog each time.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div
                ref={dialogRef}
                tabIndex={-1}
                className={`relative flex w-full max-h-[min(90vh,calc(100dvh-2rem))] flex-col ${sizeClasses[size]} overflow-hidden rounded-lg border border-border bg-surface-2 shadow-xl shadow-black/40`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
            >
                <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-4">
                    <h2 id="modal-title" className="font-display text-base font-semibold text-text-primary">
                        {title}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-text-muted hover:text-text-primary transition-colors"
                        aria-label="Close"
                    >
                        <IoClose size={20} />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                    {children}
                </div>
            </div>
        </div>
    )
}

export default Modal
