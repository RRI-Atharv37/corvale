import React from 'react'
import { Link } from 'react-router-dom'
import ExternalLink from '../ui/ExternalLink'

/**
 * A deliberately small Markdown renderer for the legal documents in `src/legal/` (M0c).
 *
 * It supports exactly the constructs those five documents use - headings, paragraphs, bold,
 * italics, inline code, links, blockquotes, bulleted lists, and pipe tables - and nothing else.
 * That is a constraint, not an oversight: pulling a full Markdown pipeline into a finance app to
 * render five files we author ourselves would add a dependency tree for no reader-visible gain,
 * in a codebase that already goes out of its way to avoid third-party surface (strict CSP, no
 * CDN fonts).
 *
 * The input is always trusted - the documents are compiled in from the repository at build time,
 * never fetched - so this parser does not need to defend against hostile Markdown. It renders
 * React elements rather than HTML strings, so there is no `dangerouslySetInnerHTML` anywhere.
 *
 * If a future document needs a construct that isn't here (images, nested lists, numbered lists
 * with custom markers), add it here rather than working around it in the Markdown.
 */

/** Rewrites the sibling links used inside the documents to their in-app routes. */
const toAppHref = (href: string): string => {
    if (href.startsWith('./') && href.endsWith('.md')) {
        return `/${href.slice(2, -3)}`
    }
    return href
}

const isExternal = (href: string): boolean => /^https?:\/\//.test(href)

/** Bold, italics, inline code, and links. Applied to every run of text. */
const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
    const pattern = /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(`[^`]+`)|(\*[^*]+\*)/g
    const nodes: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    let i = 0

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(text.slice(lastIndex, match.index))
        }

        const token = match[0]
        const key = `${keyPrefix}-i${i++}`

        if (token.startsWith('[')) {
            const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
            if (linkMatch) {
                const [, label, rawHref] = linkMatch
                const href = toAppHref(rawHref)
                if (isExternal(href)) {
                    nodes.push(
                        <ExternalLink
                            key={key}
                            href={href}
                            className="text-accent underline underline-offset-2 hover:opacity-80"
                        >
                            {label}
                        </ExternalLink>
                    )
                } else if (href.startsWith('#')) {
                    nodes.push(
                        <a key={key} href={href} className="text-accent underline underline-offset-2 hover:opacity-80">
                            {label}
                        </a>
                    )
                } else {
                    nodes.push(
                        <Link key={key} to={href} className="text-accent underline underline-offset-2 hover:opacity-80">
                            {label}
                        </Link>
                    )
                }
            }
        } else if (token.startsWith('**')) {
            nodes.push(
                <strong key={key} className="font-semibold text-text-primary">
                    {token.slice(2, -2)}
                </strong>
            )
        } else if (token.startsWith('`')) {
            nodes.push(
                <code key={key} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em]">
                    {token.slice(1, -1)}
                </code>
            )
        } else {
            nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
        }

        lastIndex = match.index + token.length
    }

    if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex))
    }

    return nodes
}

/** Turns `| a | b |` into cells, dropping the outer pipes. */
const splitRow = (line: string): string[] =>
    line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())

const isTableSeparator = (line: string): boolean => /^\|[\s:|-]+\|$/.test(line.trim())

const MarkdownDocument: React.FC<{ source: string }> = ({ source }) => {
    const lines = source.replace(/\r\n/g, '\n').split('\n')
    const blocks: React.ReactNode[] = []
    let i = 0
    let key = 0

    while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()

        if (!trimmed) {
            i += 1
            continue
        }

        // Table: a header row, a separator row, then body rows.
        if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const header = splitRow(trimmed)
            i += 2
            const rows: string[][] = []
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                rows.push(splitRow(lines[i].trim()))
                i += 1
            }
            // A leading empty header cell is a layout device in these documents, not a column name.
            const showHeader = header.some((cell) => cell.length > 0)
            blocks.push(
                <div key={`b${key++}`} className="my-5 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                        {showHeader && (
                            <thead>
                                <tr className="border-b border-border-subtle">
                                    {header.map((cell, c) => (
                                        <th
                                            key={c}
                                            className="px-3 py-2 text-left font-semibold text-text-primary"
                                        >
                                            {renderInline(cell, `h${key}-${c}`)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                        )}
                        <tbody>
                            {rows.map((row, r) => (
                                <tr key={r} className="border-b border-border-subtle/50 align-top">
                                    {row.map((cell, c) => (
                                        <td key={c} className="px-3 py-2 text-text-secondary">
                                            {renderInline(cell, `c${key}-${r}-${c}`)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )
            continue
        }

        // Blockquote: one or more consecutive `>` lines.
        if (trimmed.startsWith('>')) {
            const quoted: string[] = []
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                quoted.push(lines[i].trim().replace(/^>\s?/, ''))
                i += 1
            }
            blocks.push(
                <blockquote
                    key={`b${key++}`}
                    className="my-5 rounded-r border-l-2 border-accent/50 bg-surface/40 px-4 py-3 text-sm text-text-secondary"
                >
                    {renderInline(quoted.join(' '), `q${key}`)}
                </blockquote>
            )
            continue
        }

        // Bulleted list. The documents hard-wrap at 100 columns, so an item routinely continues
        // onto indented following lines - those belong to the item above, not to a new block.
        if (trimmed.startsWith('- ')) {
            const items: string[] = []
            while (i < lines.length) {
                const current = lines[i].trim()
                if (current.startsWith('- ')) {
                    items.push(current.slice(2))
                    i += 1
                    continue
                }
                const isContinuation =
                    items.length > 0 &&
                    current.length > 0 &&
                    !current.startsWith('|') &&
                    !current.startsWith('>') &&
                    !/^#{2,4}\s/.test(current) &&
                    !/^-{3,}$/.test(current)
                if (!isContinuation) {
                    break
                }
                items[items.length - 1] += ` ${current}`
                i += 1
            }
            blocks.push(
                <ul key={`b${key++}`} className="my-4 list-disc space-y-2 pl-6 text-text-secondary">
                    {items.map((item, n) => (
                        <li key={n}>{renderInline(item, `l${key}-${n}`)}</li>
                    ))}
                </ul>
            )
            continue
        }

        // Headings. The documents never use an H1 - the page supplies the title.
        const heading = /^(#{2,4})\s+(.*)$/.exec(trimmed)
        if (heading) {
            const level = heading[1].length
            const text = heading[2]
            const id = text
                .toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .trim()
                .replace(/\s+/g, '-')

            if (level === 2) {
                blocks.push(
                    <h2
                        key={`b${key++}`}
                        id={id}
                        className="mt-10 mb-3 scroll-mt-24 text-xl font-semibold text-text-primary"
                    >
                        {renderInline(text, `h${key}`)}
                    </h2>
                )
            } else if (level === 3) {
                blocks.push(
                    <h3
                        key={`b${key++}`}
                        id={id}
                        className="mt-7 mb-2 scroll-mt-24 text-base font-semibold text-text-primary"
                    >
                        {renderInline(text, `h${key}`)}
                    </h3>
                )
            } else {
                blocks.push(
                    <h4 key={`b${key++}`} id={id} className="mt-5 mb-2 scroll-mt-24 text-sm font-semibold text-text-primary">
                        {renderInline(text, `h${key}`)}
                    </h4>
                )
            }
            i += 1
            continue
        }

        // Horizontal rule.
        if (/^-{3,}$/.test(trimmed)) {
            blocks.push(<hr key={`b${key++}`} className="my-8 border-border-subtle" />)
            i += 1
            continue
        }

        // Paragraph: consecutive non-blank lines that start no other block.
        const paragraph: string[] = []
        while (i < lines.length) {
            const current = lines[i].trim()
            if (
                !current ||
                current.startsWith('|') ||
                current.startsWith('>') ||
                current.startsWith('- ') ||
                /^#{2,4}\s/.test(current) ||
                /^-{3,}$/.test(current)
            ) {
                break
            }
            paragraph.push(current)
            i += 1
        }

        if (paragraph.length) {
            blocks.push(
                <p key={`b${key++}`} className="my-4 leading-relaxed text-text-secondary">
                    {renderInline(paragraph.join(' '), `p${key}`)}
                </p>
            )
        }
    }

    return <div className="text-sm sm:text-base">{blocks}</div>
}

export default MarkdownDocument
