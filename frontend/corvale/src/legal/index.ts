import contactMd from './contact.md?raw'
import cookiesMd from './cookies.md?raw'
import financialDisclaimerMd from './financial-disclaimer.md?raw'
import privacyMd from './privacy.md?raw'
import refundPolicyMd from './refund-policy.md?raw'
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
 * `dpa-template.md` lives in this folder too but is deliberately **not** listed below or routed
 * anywhere - a DPA is sent to a workspace customer on request, not published as a unilateral
 * policy (see `.project/TODO.md` / `PAPERWORK.md` §9). Fill in its `[[TOKEN]]`s per customer
 * before sending.
 *
 * All fact placeholders were resolved on 2026-08-29 (launch); no `[[TOKEN]]`s remain. Documents no
 * longer share one date - each carries the date it was last materially changed. `terms.md`,
 * `privacy.md`, `cookies.md` and `refund-policy.md` track `TERMS_VERSION` / `PRIVACY_VERSION` /
 * `COOKIES_VERSION` in `backend/src/modules/users/legalVersions.ts` (bumping any forces re-acceptance through
 * `LegalGate`); `financial-disclaimer.md` and `contact.md` are dated independently and are not
 * gated by either version. See `PAPERWORK.md` for the pre-publish checklist.
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
        slug: 'refund-policy',
        path: '/refund-policy',
        title: 'Refund Policy',
        summary: 'Cancellations, refunds, disputes, and what each one does to your access.',
        body: refundPolicyMd,
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
