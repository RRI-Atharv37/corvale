import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FiCheckCircle, FiChevronDown, FiClock, FiDownload } from 'react-icons/fi'
import BrandLogo from '../components/ui/BrandLogo'
import { detectPlatform, type DesktopPlatformId } from '../utils/platformDetect'
import { getReleaseManifest, type PlatformRelease, type ReleaseAsset } from '../data/releaseManifest'

const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? 'http://localhost:5174'

const platformIcon: Record<DesktopPlatformId, string> = {
    windows: '🪟',
    macos: '🍎',
    linux: '🐧',
}

const formatSize = (sizeBytes: number | null): string | null =>
    sizeBytes === null ? null : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`

const AlternateAssetRow: React.FC<{ asset: ReleaseAsset }> = ({ asset }) => {
    const size = formatSize(asset.sizeBytes)
    const details = (
        <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">
                {asset.label}
                {size && <span className="text-text-muted"> ({size})</span>}
            </p>
            {asset.sha256 && (
                <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted" title={asset.sha256}>
                    SHA-256: {asset.sha256}
                </p>
            )}
        </div>
    )

    return (
        <li className="py-2">
            {asset.url ? (
                <a
                    href={asset.url}
                    className="flex items-center justify-between gap-3 hover:text-accent"
                >
                    {details}
                    <FiDownload size={14} className="shrink-0" />
                </a>
            ) : (
                <div className="flex items-center justify-between gap-3">
                    {details}
                    <span className="shrink-0 text-xs text-text-muted">Coming soon</span>
                </div>
            )}
        </li>
    )
}

const PlatformCard: React.FC<{ platform: PlatformRelease; recommended: boolean }> = ({
    platform,
    recommended,
}) => {
    const [showAllFormats, setShowAllFormats] = useState(false)
    const primarySize = formatSize(platform.primary.sizeBytes)

    return (
        <article
            className={`glass-card card-elevated flex flex-col rounded-xl ${
                recommended ? 'border-accent/40 ring-1 ring-accent/30' : ''
            }`}
        >
            {recommended && (
                <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/25 bg-accent-subtle px-3 py-1 text-xs font-medium text-accent-dim">
                    <FiCheckCircle size={12} />
                    Recommended for your device
                </span>
            )}
            <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">
                    {platformIcon[platform.id]}
                </span>
                <div>
                    <h3 className="font-display text-lg font-semibold text-text-primary">{platform.label}</h3>
                    <p className="text-xs text-text-muted">{platform.fileLabel}</p>
                </div>
            </div>

            <ul className="mt-4 space-y-1.5 text-sm text-text-secondary">
                {platform.systemRequirements.map((requirement) => (
                    <li key={requirement} className="flex gap-2">
                        <span className="text-accent shrink-0">→</span>
                        {requirement}
                    </li>
                ))}
            </ul>

            <div className="mt-6 pt-4 border-t border-border-subtle">
                {platform.primary.url ? (
                    <a
                        href={platform.primary.url}
                        className="btn-primary w-full text-center inline-flex items-center justify-center gap-2"
                    >
                        <FiDownload size={16} />
                        Download for {platform.label}
                        {primarySize && <span className="opacity-80">({primarySize})</span>}
                    </a>
                ) : (
                    <div className="flex items-center justify-center gap-2 rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-muted">
                        <FiClock size={16} />
                        Coming soon
                    </div>
                )}
                {platform.primary.sha256 && (
                    <p className="mt-2 truncate text-center font-mono text-[11px] text-text-muted" title={platform.primary.sha256}>
                        SHA-256: {platform.primary.sha256}
                    </p>
                )}
            </div>

            {platform.alternates.length > 0 && (
                <div className="mt-2">
                    <button
                        type="button"
                        onClick={() => setShowAllFormats((open) => !open)}
                        aria-expanded={showAllFormats}
                        className="flex w-full items-center justify-center gap-1.5 py-2 text-xs font-medium text-text-muted hover:text-text-secondary"
                    >
                        See all formats
                        <FiChevronDown
                            size={14}
                            className={`transition-transform ${showAllFormats ? 'rotate-180' : ''}`}
                        />
                    </button>
                    {showAllFormats && (
                        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                            {platform.alternates.map((asset) => (
                                <AlternateAssetRow key={asset.label} asset={asset} />
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </article>
    )
}

const Download: React.FC = () => {
    const manifest = useMemo(() => getReleaseManifest(), [])
    const detected = useMemo(() => detectPlatform(), [])

    return (
        <div className="min-h-screen bg-page text-text-primary">
            <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
                <div className="glass-nav mx-auto flex max-w-5xl items-center justify-between rounded-full px-4 py-2.5 sm:px-6">
                    <BrandLogo size="sm" showTagline={false} />
                    {/* "/" resolves to the dashboard for an authenticated user (see HomeRoute in
                        App.tsx) and to the landing page for a guest, so one link works for both. */}
                    <Link to="/" className="btn-ghost py-2 px-3">
                        Back to spndr
                    </Link>
                </div>
            </header>

            <main className="px-4 py-14 sm:px-6">
                <div className="mx-auto max-w-5xl">
                    <div className="text-center">
                        <p className="section-label">Desktop app</p>
                        <h1 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                            Download spndr for Desktop
                        </h1>
                        <p className="mt-4 mx-auto max-w-xl text-text-secondary leading-relaxed">
                            The same spndr you use online, packaged as a native app for Windows, macOS, and
                            Linux - with encrypted offline storage and a real save dialog for backups.
                        </p>
                    </div>

                    <div className="mt-12 grid gap-4 sm:grid-cols-3">
                        {manifest.platforms.map((platform) => (
                            <PlatformCard
                                key={platform.id}
                                platform={platform}
                                recommended={platform.id === detected}
                            />
                        ))}
                    </div>

                    {!manifest.available && (
                        <p className="mt-6 text-center text-sm text-text-muted">
                            Signed installers are in progress - checksums for each build will be published
                            here once they ship.{' '}
                            <a
                                href={manifest.releaseNotesUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent hover:underline"
                            >
                                Watch the releases page
                            </a>
                            .
                        </p>
                    )}

                    <section className="mt-16">
                        <p className="section-label">What&apos;s included</p>
                        <h2 className="font-display mt-3 text-2xl font-bold tracking-tight">
                            Version {manifest.version} highlights
                        </h2>
                        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                            {manifest.highlights.map((highlight) => (
                                <li key={highlight} className="glass-card card rounded-xl text-sm text-text-secondary leading-relaxed">
                                    {highlight}
                                </li>
                            ))}
                        </ul>
                    </section>

                    <p className="mt-16 text-center text-sm text-text-muted">
                        Want the full picture first?{' '}
                        <a
                            href={`${DOCS_URL}/desktop/overview`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                        >
                            Desktop app docs
                        </a>
                    </p>
                </div>
            </main>
        </div>
    )
}

export default Download
