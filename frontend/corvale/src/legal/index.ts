import contactMd from './contact.md?raw'
import cookiesMd from './cookies.md?raw'
import financialDisclaimerMd from './financial-disclaimer.md?raw'
import privacyMd from './privacy.md?raw'
import termsMd from './terms.md?raw'

/**
 * The canonical legal documents (M0c).
 *
 * These `.md` files are the single source of truth. The docs site pulls the same files in through
 * VitePress `@include` directives in `docs/legal/`, so the app and the documentation can never
 * drift apart - there is one copy of the wording, rendered twice.
 *
 * They are imported with `?raw` and compiled into the bundle, so the pages work offline and need
 * no network round trip. The bodies deliberately carry no H1: each surface supplies its own title
 * (frontmatter on the docs site, `LegalPage` here).
 *
 * All fact placeholders were resolved on 2026-08-29, and `[[EFFECTIVE_DATE]]` was filled on the
 * same day (launch): every document now carries `2026-08-29`, matching `TERMS_VERSION` /
 * `PRIVACY_VERSION` in `backend/utils/legalVersions.ts`. No `[[TOKEN]]`s remain. See `PAPERWORK.md`
 * for the pre-publish checklist.
 */

export interface LegalDocument {
    slug: string
    path: string
    title: string
    /** Shown under the title. Not part of the legal text itself. */
    summary: string
    body: string
}

export const LEGAL_DOCUMENTS: LegalDocument[] = [
    {
        slug: 'privacy',
        path: '/privacy',
        title: 'Privacy Policy',
        summary: 'What we collect, why, how long we keep it, and the rights you have over it.',
        body: privacyMd,
    },
    {
        slug: 'terms',
        path: '/terms',
        title: 'Terms of Service',
        summary: 'The agreement covering your use of the hosted Corvale service.',
        body: termsMd,
    },
    {
        slug: 'cookies',
        path: '/cookies',
        title: 'Cookie Policy',
        summary: 'The one cookie Corvale sets, and what it keeps in your browser.',
        body: cookiesMd,
    },
    {
        slug: 'financial-disclaimer',
        path: '/financial-disclaimer',
        title: 'Financial Disclaimer',
        summary: 'Why Corvale is a record-keeping tool, not financial advice.',
        body: financialDisclaimerMd,
    },
    {
        slug: 'contact',
        path: '/contact',
        title: 'Contact',
        summary: 'Privacy requests, support, security reports, and everything else.',
        body: contactMd,
    },
]

export const getLegalDocument = (slug: string): LegalDocument | undefined =>
    LEGAL_DOCUMENTS.find((doc) => doc.slug === slug)
