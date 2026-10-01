import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import {
    MAX_AMOUNT_MAJOR,
    parseAmountToMinorUnits,
    parseSignedMajorAmount,
} from '@shared/money'

async function setup(email: string) {
    const { token } = await seedUserDirectly({ email })
    const account = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance: 100 })
    const categories = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = categories.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    return { token, accountId: account.body.data._id as string, categoryId: food._id as string }
}

const postTransaction = (
    token: string,
    accountId: string,
    categoryId: string,
    amount: unknown
) =>
    request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Probe',
            amount,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
        })

describe('shared money parsing (BUG-77)', () => {
    it('accepts plain decimals and numbers up to the cap', () => {
        expect(parseAmountToMinorUnits('10.50')).toBe(1050)
        expect(parseAmountToMinorUnits(12)).toBe(1200)
        expect(parseAmountToMinorUnits(MAX_AMOUNT_MAJOR)).toBe(MAX_AMOUNT_MAJOR * 100)
        expect(parseSignedMajorAmount('-12.5')).toBe(-12.5)
        expect(parseSignedMajorAmount(-MAX_AMOUNT_MAJOR)).toBe(-MAX_AMOUNT_MAJOR)
    })

    it.each([
        ['0x10'],
        ['1e3'],
        [' 5'],
        ['5 '],
        ['+5'],
        ['1,000'],
        ['Infinity'],
        ['NaN'],
        [''],
        [true],
        [[]],
        [null],
        [Number.POSITIVE_INFINITY],
        [Number.NaN],
        [MAX_AMOUNT_MAJOR + 1],
        [1e300],
    ])('rejects %j', (value) => {
        expect(() => parseAmountToMinorUnits(value)).toThrow()
        expect(() => parseSignedMajorAmount(value)).toThrow()
    })

    it('rejects a negative amount where only non-negative is allowed', () => {
        expect(() => parseAmountToMinorUnits(-1)).toThrow()
        expect(() => parseAmountToMinorUnits('-1')).toThrow()
    })
})

describe('transaction amounts (BUG-77)', () => {
    it('stores an amount at the cap', async () => {
        const { token, accountId, categoryId } = await setup('hygiene-cap@example.com')

        const res = await postTransaction(token, accountId, categoryId, MAX_AMOUNT_MAJOR)

        expect(res.status).toBe(201)
    })

    it.each([[MAX_AMOUNT_MAJOR + 1], [1e300], ['0x10'], ['1e3'], [true], [[]]])(
        'rejects the amount %j with 400',
        async (amount) => {
            const { token, accountId, categoryId } = await setup('hygiene-amount@example.com')

            const res = await postTransaction(token, accountId, categoryId, amount)

            expect(res.status).toBe(400)
        }
    )
})

describe('account opening balance (BUG-77)', () => {
    it.each([[1e300], [MAX_AMOUNT_MAJOR + 1], ['0x10'], ['1e3'], [true]])(
        'rejects the opening balance %j with 400',
        async (openingBalance) => {
            const { token } = await setup('hygiene-opening@example.com')

            const res = await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(token))
                .send({ name: 'Other', type: 'checking', openingBalance })

            expect(res.status).toBe(400)
        }
    )

    it('still accepts a negative decimal opening balance', async () => {
        const { token } = await setup('hygiene-opening-negative@example.com')

        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Overdrawn', type: 'checking', openingBalance: -120.55 })

        expect(res.status).toBe(201)
        expect(res.body.data.openingBalance).toBe(-120.55)
    })
})

describe('type-confused parameters return 400 (BUG-77)', () => {
    it('GET /transactions/search with a repeated keyword', async () => {
        const { token } = await setup('hygiene-search@example.com')

        const res = await request(app)
            .get('/api/v1/transactions/search?keyword=a&keyword=b')
            .set(authHeader(token))

        expect(res.status).toBe(400)
    })

    it('GET /transactions/search with an object keyword', async () => {
        const { token } = await setup('hygiene-search-object@example.com')

        const res = await request(app)
            .get('/api/v1/transactions/search?keyword[x]=a')
            .set(authHeader(token))

        expect(res.status).toBe(400)
    })

    it.each([['1e3'], ['0x10'], ['-5'], ['1e300']])(
        'GET /transactions/search?keyword=%s is a text search, not an error',
        async (keyword) => {
            const { token } = await setup('hygiene-search-numeric@example.com')

            const res = await request(app)
                .get(`/api/v1/transactions/search?keyword=${encodeURIComponent(keyword)}`)
                .set(authHeader(token))

            expect(res.status).toBe(200)
        }
    )

    it('GET /recurring-rules/drafts with a malformed ruleId', async () => {
        const { token } = await setup('hygiene-drafts@example.com')

        const res = await request(app)
            .get('/api/v1/recurring-rules/drafts?ruleId=bad')
            .set(authHeader(token))

        expect(res.status).toBe(400)
    })

    it('POST /tags with a numeric color', async () => {
        const { token } = await setup('hygiene-tag-color@example.com')

        const res = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Travel', color: 5 })

        expect(res.status).toBe(400)
    })

    it('POST /tags with a numeric name', async () => {
        const { token } = await setup('hygiene-tag-name@example.com')

        const res = await request(app).post('/api/v1/tags').set(authHeader(token)).send({ name: 5 })

        expect(res.status).toBe(400)
    })

    it('PUT /tags/:id with an object color', async () => {
        const { token } = await setup('hygiene-tag-update@example.com')
        const created = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Travel', color: '#112233' })
        expect(created.status).toBe(201)

        const res = await request(app)
            .put(`/api/v1/tags/${created.body.data._id}`)
            .set(authHeader(token))
            .send({ color: { nope: true } })

        expect(res.status).toBe(400)
    })

    it('POST /tags still accepts a string color', async () => {
        const { token } = await setup('hygiene-tag-ok@example.com')

        const res = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Travel', color: '#112233' })

        expect(res.status).toBe(201)
        expect(res.body.data.color).toBe('#112233')
    })
})

describe('list page size (BUG-77)', () => {
    it('GET /transactions caps limit at 500 and reports the effective limit', async () => {
        const { token } = await setup('hygiene-limit@example.com')

        const res = await request(app).get('/api/v1/transactions?limit=100000').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.meta.limit).toBe(500)
    })

    it('GET /transactions honours a limit under the cap', async () => {
        const { token } = await setup('hygiene-limit-ok@example.com')

        const res = await request(app).get('/api/v1/transactions?limit=25').set(authHeader(token))

        expect(res.body.data.meta.limit).toBe(25)
    })

    it.each([['0'], ['-1'], ['abc'], ['0x10']])('GET /transactions?limit=%s is a 400', async (limit) => {
        const { token } = await setup('hygiene-limit-bad@example.com')

        const res = await request(app).get(`/api/v1/transactions?limit=${limit}`).set(authHeader(token))

        expect(res.status).toBe(400)
    })
})
