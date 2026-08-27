// Fallback used only when the runtime has no Intl.supportedValuesOf (older browsers/webviews) —
// the real list below normally comes straight from the ICU data every modern JS engine ships.
const FALLBACK_TIMEZONES = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Africa/Cairo',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Australia/Sydney',
    'Pacific/Auckland',
]

export const getTimezoneOptions = (): string[] => {
    let zones = FALLBACK_TIMEZONES

    if (typeof Intl.supportedValuesOf === 'function') {
        try {
            const values = Intl.supportedValuesOf('timeZone')
            if (values.length > 0) zones = values
        } catch {
            // fall through to the fixed list above
        }
    }

    // Valid per Intl.DateTimeFormat (and thus backend's isValidTimezone) and the User model's
    // default, but ICU's supportedValuesOf('timeZone') omits it as it isn't a real IANA zone.
    return zones.includes('UTC') ? zones : ['UTC', ...zones]
}
