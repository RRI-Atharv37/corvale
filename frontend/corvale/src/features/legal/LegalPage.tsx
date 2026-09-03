import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import MarkdownDocument from './components/MarkdownDocument'
import BrandLogo from '@ui/BrandLogo'
import { LEGAL_DOCUMENTS, LegalDocument } from '@/legal'

/**
 * Shell for the five public legal pages (M0c).
 *
 * These are deliberately reachable without an account: a Merchant-of-Record reviewer, a
 * prospective user, or someone exercising a data right all need to read them before signing in,
 * and a policy behind a login wall is not a published policy.
 */
const LegalPage: React.FC<{ document: LegalDocument }> = ({ document: doc }) => {
    useEffect(() => {
        const previous = window.document.title
        window.document.title = `${doc.title} · Corvale`
        return () => {
            window.document.title = previous
        }
    }, [doc.title])

    return (
        <div className="min-h-screen bg-page">
            <header className="border-b border-border-subtle px-4 py-5 sm:px-6">
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
                    <BrandLogo size="sm" linkTo="/" />
                    <Link
                        to="/"
                        className="text-sm text-text-secondary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                    >
                        Back to Corvale
                    </Link>
                </div>
            </header>

            <main className="px-4 py-10 sm:px-6">
                <article className="mx-auto max-w-3xl">
                    <h1 className="font-display text-2xl font-semibold text-text-primary sm:text-3xl">
                        {doc.title}
                    </h1>
                    <p className="mt-2 text-sm text-text-secondary">{doc.summary}</p>

                    <MarkdownDocument source={doc.body} />
                </article>
            </main>

            <footer className="border-t border-border-subtle px-4 py-8 sm:px-6">
                <nav
                    aria-label="Legal documents"
                    className="mx-auto flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-2 text-sm"
                >
                    {LEGAL_DOCUMENTS.map((other) =>
                        other.slug === doc.slug ? (
                            <span key={other.slug} className="text-text-secondary/60">
                                {other.title}
                            </span>
                        ) : (
                            <Link
                                key={other.slug}
                                to={other.path}
                                className="text-text-secondary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                            >
                                {other.title}
                            </Link>
                        )
                    )}
                </nav>
            </footer>
        </div>
    )
}

export default LegalPage
