import React from 'react'
import { Link } from 'react-router-dom'
import { BRAND } from '@lib/brand'

interface BrandLogoProps {
    showTagline?: boolean
    size?: 'sm' | 'md' | 'lg'
    linkTo?: string | null
}

const sizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
} as const

const BrandLogo: React.FC<BrandLogoProps> = ({
    showTagline = false,
    size = 'md',
    linkTo = '/',
}) => {
    const content = (
        <>
            <span className={`font-display font-bold tracking-tight ${sizeClasses[size]}`}>
                <span className="text-gradient-accent">{BRAND.name}</span>
            </span>
            {showTagline && (
                <p className="text-xs text-text-muted mt-0.5 font-body">{BRAND.tagline}</p>
            )}
        </>
    )

    if (linkTo === null) {
        return <div>{content}</div>
    }

    return (
        <Link to={linkTo} className="inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm">
            {content}
        </Link>
    )
}

export default BrandLogo
