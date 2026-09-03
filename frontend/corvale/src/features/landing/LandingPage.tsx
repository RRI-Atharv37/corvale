import React from 'react'
import { Link } from 'react-router-dom'
import BrandLogo from '@ui/BrandLogo'
import LandingProductPreview from './components/LandingProductPreview'
import LedgerPulse from '@ui/LedgerPulse'
import { AUTHOR, BRAND, PAIN_POINTS, FEATURES, STEPS } from '@lib/brand'
import ExternalLink from '@ui/ExternalLink'
import { LEGAL_DOCUMENTS } from '@/legal'

const Landing: React.FC = () => {
    return (
        <div className="min-h-screen bg-page text-text-primary">
            {/* Floating pill nav */}
            <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
                <div className="glass-nav mx-auto flex max-w-5xl items-center justify-between rounded-full px-4 py-2.5 sm:px-6">
                    <BrandLogo size="sm" showTagline={false} />
                    <nav className="flex items-center gap-1 sm:gap-2">
                        <Link to="/download" className="btn-ghost py-2 px-3 hidden sm:inline-flex">
                            Download app
                        </Link>
                        <Link to="/login" className="btn-ghost py-2 px-3">
                            Log in
                        </Link>
                        <Link to="/signup" className="btn-primary py-2 px-5 w-auto whitespace-nowrap text-sm">
                            {BRAND.cta}
                        </Link>
                    </nav>
                </div>
            </header>

            <main>
                {/* ATTENTION — hero */}
                <section className="relative overflow-hidden px-4 pt-10 pb-20 sm:px-6 sm:pt-16 sm:pb-28">
                    <div className="landing-glow pointer-events-none absolute inset-0" aria-hidden="true" />
                    <div className="landing-hero-glow pointer-events-none absolute inset-x-0 top-0 h-[480px]" aria-hidden="true" />
                    <div className="relative mx-auto max-w-6xl">
                        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                            <div className="animate-fade-up">
                                <span className="inline-flex items-center rounded-full border border-accent/25 bg-accent-subtle px-3 py-1 text-xs font-medium text-accent-dim">
                                    {BRAND.audience}
                                </span>
                                <h1 className="font-display mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-[3.25rem]">
                                    {BRAND.headline}
                                    <span className="text-gradient-accent">.</span>
                                </h1>
                                <p className="mt-5 max-w-lg text-lg text-text-secondary leading-relaxed">
                                    {BRAND.adHook} {BRAND.name} shows you where your money actually goes — before rent
                                    week turns into panic.
                                </p>

                                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                                    <Link to="/signup" className="btn-primary sm:w-auto sm:min-w-[200px]">
                                        {BRAND.cta}
                                    </Link>
                                    <a href="#how-it-works" className="btn-secondary sm:w-auto text-center">
                                        {BRAND.ctaSecondary}
                                    </a>
                                </div>

                                <p className="mt-6 text-xs text-text-muted-bright">
                                    Free to start · No credit card · Built for irregular income
                                </p>

                                <p className="mt-3 text-xs text-text-muted-bright">
                                    Prefer an installed app?{' '}
                                    <Link to="/download" className="font-semibold text-accent hover:underline">
                                        Get the desktop app
                                    </Link>
                                </p>
                            </div>

                            <div className="animate-fade-up lg:animate-none" style={{ animationDelay: '0.1s' }}>
                                <LandingProductPreview />
                            </div>
                        </div>
                    </div>
                </section>

                <LedgerPulse variant="wide" className="max-w-4xl mx-auto opacity-60" />

                {/* PAIN — agitate with consequences */}
                <section className="border-t border-border-subtle bg-bg-secondary/50 px-4 py-20 sm:px-6">
                    <div className="mx-auto max-w-6xl">
                        <p className="section-label">The problem</p>
                        <h2 className="font-display mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                            Money leaves quietly. The stress doesn&apos;t.
                        </h2>
                        <p className="mt-4 max-w-2xl text-text-secondary leading-relaxed">
                            You&apos;re not bad with money. You&apos;re flying blind — and the cost isn&apos;t just
                            dollars. It&apos;s the overdraft fee, the plan you skip, the sleep you lose before rent.
                        </p>

                        <div className="mt-12 grid gap-4 md:grid-cols-2">
                            {PAIN_POINTS.map((pain) => (
                                <article key={pain.title} className="glass-card card-elevated flex flex-col rounded-xl">
                                    <div className="flex items-baseline justify-between gap-4 mb-4">
                                        <h3 className="font-display text-lg font-semibold text-text-primary">
                                            {pain.title}
                                        </h3>
                                        <div className="text-right shrink-0">
                                            <p className="font-mono-data text-2xl font-medium text-negative">
                                                {pain.stat}
                                            </p>
                                            <p className="text-xs text-text-muted">{pain.statLabel}</p>
                                        </div>
                                    </div>
                                    <p className="text-sm text-text-secondary leading-relaxed">{pain.scenario}</p>
                                    <p className="text-sm text-text-muted leading-relaxed mt-4 pt-4 border-t border-border-subtle">
                                        {pain.consequence}
                                    </p>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                {/* RESONATE — mirror their inner voice */}
                <section className="px-4 py-20 sm:px-6">
                    <div className="mx-auto max-w-3xl text-center">
                        <p className="section-label">Sound familiar?</p>
                        <blockquote className="font-display mt-6 text-2xl sm:text-3xl font-semibold leading-snug text-text-primary text-balance">
                            &ldquo;I make enough. I just don&apos;t know where it goes. And every month I promise
                            myself I&apos;ll figure it out — then I don&apos;t.&rdquo;
                        </blockquote>
                        <p className="mt-6 text-text-secondary">
                            That&apos;s not a discipline problem. It&apos;s a visibility problem. And visibility is
                            fixable.
                        </p>
                    </div>
                </section>

                {/* EDUCATE — who, how, simplify into steps */}
                <section id="how-it-works" className="border-t border-border-subtle bg-bg-secondary/50 px-4 py-20 sm:px-6">
                    <div className="mx-auto max-w-6xl">
                        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
                            <div>
                                <p className="section-label">Built for you</p>
                                <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                                    Who {BRAND.name} is for
                                </h2>
                                <p className="mt-4 text-text-secondary leading-relaxed">
                                    {BRAND.audience}. Part-time jobs, side gigs, student loans, split rent — your
                                    income isn&apos;t a neat salary, and your tools shouldn&apos;t assume one.
                                </p>
                                <ul className="mt-6 space-y-3 text-sm text-text-secondary">
                                    <li className="flex gap-3">
                                        <span className="text-accent shrink-0">→</span>
                                        You check your balance and feel a punch you can&apos;t explain
                                    </li>
                                    <li className="flex gap-3">
                                        <span className="text-accent shrink-0">→</span>
                                        You&apos;ve tried spreadsheets or apps and stopped within a month
                                    </li>
                                    <li className="flex gap-3">
                                        <span className="text-accent shrink-0">→</span>
                                        You want to save for something real, not just &ldquo;be better with money&rdquo;
                                    </li>
                                </ul>
                            </div>

                            <div>
                                <p className="section-label">How it delivers</p>
                                <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                                    One place for all of it
                                </h2>
                                <p className="mt-4 text-text-secondary leading-relaxed">
                                    {BRAND.name} replaces the mental math. Log what you spend, set limits that match
                                    your life, and check a dashboard that tells the truth — not the story you tell
                                    yourself.
                                </p>
                                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                                    {STEPS.map((item) => (
                                        <div key={item.step} className="glass-card card rounded-xl text-center sm:text-left">
                                            <p className="font-display text-xl font-bold text-gradient-accent">{item.step}</p>
                                            <p className="mt-2 text-xs text-text-muted leading-relaxed">
                                                {item.description}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* INTEREST + DESIRE — what the product offers */}
                <section className="px-4 py-20 sm:px-6">
                    <div className="mx-auto max-w-6xl">
                        <p className="section-label">What you get</p>
                        <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                            Everything to stop guessing
                        </h2>
                        <p className="mt-4 max-w-2xl text-text-secondary">
                            {BRAND.tagline} Track transactions, set budgets, hit savings goals, and pull reports —
                            without learning accounting.
                        </p>

                        <div className="mt-12 grid gap-4 sm:grid-cols-2">
                            {FEATURES.map((feature) => (
                                <div
                                    key={feature.title}
                                    className="glass-card card group rounded-xl hover:border-accent/30 transition-colors"
                                >
                                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-accent-subtle border border-accent/20">
                                        <span className="h-2 w-2 rounded-full bg-accent" />
                                    </div>
                                    <h3 className="font-display font-semibold text-text-primary group-hover:text-accent transition-colors">
                                        {feature.title}
                                    </h3>
                                    <p className="mt-2 text-sm text-text-muted leading-relaxed">
                                        {feature.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* OFFER + ACTION — final CTA with urgency */}
                <section className="relative px-4 py-24 sm:px-6 overflow-hidden">
                    <div
                        className="pointer-events-none absolute inset-0"
                        aria-hidden="true"
                        style={{
                            background:
                                'radial-gradient(ellipse 70% 60% at 50% 100%, #9333ea18 0%, transparent 65%)',
                        }}
                    />
                    <div className="relative mx-auto max-w-3xl text-center">
                        <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">
                            {BRAND.headline}
                            <span className="text-gradient-accent">.</span>
                        </h2>
                        <p className="mt-4 text-lg text-text-secondary">
                            {BRAND.tagline} Join free — no credit card, no lecture about lattes.
                        </p>
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                            <Link to="/signup" className="btn-primary sm:w-auto sm:min-w-[220px]">
                                {BRAND.cta}
                            </Link>
                            <Link to="/login" className="btn-secondary sm:w-auto">
                                I already have an account
                            </Link>
                        </div>
                        <p className="mt-6 text-xs text-text-muted-bright">
                            Every day without tracking is another day your money decides for you.
                        </p>
                    </div>
                </section>
            </main>

            <footer className="relative border-t border-accent/25 px-4 py-14 sm:px-6 overflow-hidden">
                <div
                    className="pointer-events-none absolute inset-0"
                    aria-hidden="true"
                    style={{
                        background:
                            'radial-gradient(ellipse 80% 100% at 50% 100%, #9333ea14 0%, transparent 60%)',
                    }}
                />
                <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-5 text-center">
                    <BrandLogo size="lg" linkTo="/" />
                    <p className="font-display text-base sm:text-lg font-semibold text-text-secondary tracking-wide">
                        {BRAND.tagline}
                    </p>
                    <Link
                        to="/download"
                        className="text-sm font-semibold text-gradient-accent hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                    >
                        Download the desktop app
                    </Link>
                    <nav
                        aria-label="Legal"
                        className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-text-secondary"
                    >
                        {LEGAL_DOCUMENTS.map((doc) => (
                            <Link
                                key={doc.slug}
                                to={doc.path}
                                className="transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                            >
                                {doc.title}
                            </Link>
                        ))}
                    </nav>
                    <p className="text-sm text-text-secondary">
                        Made by{' '}
                        <ExternalLink
                            href={AUTHOR.github}
                            className="font-semibold text-gradient-accent hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
                        >
                            {AUTHOR.name}
                        </ExternalLink>
                    </p>
                </div>
            </footer>
        </div>
    )
}

export default Landing
