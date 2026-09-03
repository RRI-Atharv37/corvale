import React from 'react'
import { Link } from 'react-router-dom'
import { FiExternalLink } from 'react-icons/fi'

import { LEGAL_DOCUMENTS } from '@/legal'
import { useUser } from '@/app/providers/useUser'

/**
 * Settings section collecting everything about the user's own data in one place (M0c).
 *
 * The rights the Privacy Policy promises - export, correction, erasure - are all already
 * implemented, but they were scattered across Settings with no indication that they *are* your
 * data rights. This section names them, links the documents, and points at the controls that
 * already exist rather than duplicating them.
 */
const PrivacyDataSettings: React.FC = () => {
    const { user } = useUser()
    const acceptedAt = user?.legalAcceptance?.acceptedAt

    return (
        <div>
            <p className="section-label mb-3">Privacy &amp; data</p>

            <div className="space-y-4 rounded-lg border border-border-subtle bg-bg-secondary/40 p-4">
                <div>
                    <p className="text-sm text-text-primary">What Corvale holds about you</p>
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                        Your name and email, your preferences, and the financial records you enter
                        yourself. Corvale has no bank connection, runs no analytics, and sets one cookie
                        — the one that keeps you signed in.
                    </p>
                </div>

                <div>
                    <p className="text-sm text-text-primary">Your rights</p>
                    <ul className="mt-1 space-y-1 text-sm leading-relaxed text-text-secondary">
                        <li>
                            <span className="text-text-primary">Get a copy:</span> use Backup &amp;
                            Restore above to export everything as JSON, or as a ZIP with your receipts.
                            Export is never restricted.
                        </li>
                        <li>
                            <span className="text-text-primary">Correct it:</span> everything in Corvale
                            is editable in the app.
                        </li>
                        <li>
                            <span className="text-text-primary">Delete it:</span> use Delete my account
                            below. It erases your records and receipts immediately.
                        </li>
                    </ul>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {LEGAL_DOCUMENTS.map((doc) => (
                        <Link
                            key={doc.slug}
                            to={doc.path}
                            className="inline-flex items-center gap-1.5 text-accent hover:opacity-80 transition-opacity"
                        >
                            {doc.title}
                            <FiExternalLink size={13} aria-hidden="true" />
                        </Link>
                    ))}
                </div>

                {acceptedAt && (
                    <p className="text-xs text-fg-muted">
                        You accepted the current Terms and Privacy Policy on{' '}
                        {new Date(acceptedAt).toLocaleDateString()}.
                    </p>
                )}
            </div>
        </div>
    )
}

export default PrivacyDataSettings
