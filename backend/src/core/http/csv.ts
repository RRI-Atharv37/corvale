/**
 * The one CSV row builder (SEC-17, SEC-29, SEC-86). It lives in `core/` so the admin module, which
 * may not import `transactions`, and the transactions export share a single implementation that
 * neutralises formula injection.
 */

// A leading =/+/-/@/tab/CR is prefixed with a single quote so spreadsheet software does not
// evaluate it. Applied at the start of every embedded line too: a newline inside an RFC 4180
// quoted field still renders as a physical line break, so "legit\n=cmd|calc" would otherwise put
// a formula at the start of a visible row.
export const escapeCsvValue = (value: string): string => {
    const neutralized = value.replace(/(^|\r\n|\r|\n)([=+\-@\t\r])/g, "$1'$2")

    if (/["\r\n,]/.test(neutralized)) {
        return `"${neutralized.replace(/"/g, '""')}"`
    }
    return neutralized
}

export const buildCsvRow = (row: (string | number)[]): string =>
    row.map((value) => escapeCsvValue(String(value))).join(',')
