import React, { ReactNode, useEffect } from 'react'
import { IoClose } from 'react-icons/io5'

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
    useEffect(() => {
        if (!open) return

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }

        document.addEventListener('keydown', handleEscape)
        document.body.style.overflow = 'hidden'

        return () => {
            document.removeEventListener('keydown', handleEscape)
            document.body.style.overflow = ''
        }
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div
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
