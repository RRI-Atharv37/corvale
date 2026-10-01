import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/node'

import { scrubErrorEvent } from '@infra/observability/errorTracking'

/**
 * SEC-96 - the scrubber keeps the exception message (the Privacy Policy lists it), but a Mongoose
 * message quotes the rejected value. Quoted values are stripped so a validation failure that ever
 * slips through reports the shape of the failure, not the user's input.
 */

const eventWithMessage = (value: string): ErrorEvent =>
    ({
        type: undefined,
        message: value,
        exception: { values: [{ type: 'Error', value }] },
    }) as ErrorEvent

describe('scrubErrorEvent exception messages (SEC-96)', () => {
    it('removes a double-quoted value from a cast failure', () => {
        const scrubbed = scrubErrorEvent(eventWithMessage('Cast to date failed for value "Invalid Date" (type string) at path "clearedAt"'))

        const text = JSON.stringify(scrubbed)
        expect(text).not.toContain('Invalid Date')
        expect(scrubbed.exception?.values?.[0].value).toContain('Cast to date failed for value')
    })

    it('removes the value from a min/max failure while keeping the path', () => {
        const scrubbed = scrubErrorEvent(eventWithMessage('Path `amount` (-5000) is less than minimum allowed value (0).'))

        const value = scrubbed.exception?.values?.[0].value ?? ''
        expect(value).not.toContain('-5000')
        expect(value).toContain('amount')
    })

    it('removes the value from an enum failure', () => {
        const scrubbed = scrubErrorEvent(eventWithMessage('`salary-from-acme` is not a valid enum value for path `type`.'))

        expect(JSON.stringify(scrubbed)).not.toContain('salary-from-acme')
    })

    it('leaves a message with no quoted value alone', () => {
        const scrubbed = scrubErrorEvent(eventWithMessage('connect ECONNREFUSED 127.0.0.1:27017'))

        expect(scrubbed.exception?.values?.[0].value).toBe('connect ECONNREFUSED 127.0.0.1:27017')
    })
})
