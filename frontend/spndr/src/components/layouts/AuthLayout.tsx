import React, { ReactNode } from 'react'
import BrandLogo from '../ui/BrandLogo'
import LedgerPulse from '../ui/LedgerPulse'

interface AuthLayoutProps {
    children: ReactNode
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
    return (
        <div className="relative min-h-screen bg-page flex items-center justify-center px-4 py-8 overflow-hidden">
            <div className="landing-glow pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="relative w-full max-w-md">
                <div className="mb-8 text-center">
                    <BrandLogo showTagline size="md" linkTo="/" />
                    <LedgerPulse className="max-w-[120px] mx-auto mt-4" />
                </div>

                <div className="card-elevated p-6 sm:p-8">
                    {children}
                </div>
            </div>
        </div>
    )
}

export default AuthLayout
