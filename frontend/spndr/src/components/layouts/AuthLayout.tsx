import React, { ReactNode } from 'react'

interface AuthLayoutProps{
    children: ReactNode
}

// const AuthLayout = ({children}) => {
const AuthLayout: React.FC<AuthLayoutProps> = ({children}) => {
    return <div className='flex'>
        <div className='w-screen h-screen md:w-[60vw] px-12 pt-8 pb-12'>
            <h2 className='text-lg font-medium text-black'>Expense Tracker</h2>
            {children}
        </div>
    </div>
}

export default AuthLayout