/** Escape special regex characters to prevent ReDoS from user-supplied patterns. */
export const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build a case-insensitive MongoDB regex from sanitized user input. */
export const buildSearchRegex = (keyword: string): RegExp => {
    const trimmed = keyword.trim().slice(0, 100)
    return new RegExp(escapeRegex(trimmed), 'i')
}
