import React, { ReactNode } from 'react'

interface AuthLayoutProps {
    children: ReactNode
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-8">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight">
                        <span className="text-cyan-400">spndr</span>
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">Track. Save. Grow.</p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm p-6 sm:p-8 shadow-xl shadow-black/20">
                    {children}
                </div>
            </div>
        </div>
    )
}

export default AuthLayout
