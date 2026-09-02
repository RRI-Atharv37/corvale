import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Saver } from '@modules/savers'
import { Pushover } from '@modules/savers'
import { authHeader, createPostedTransaction, registerUser } from './helpers'

describe('Pushover', () => {
    it('creates snapshot and resets saver balance on rollover', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 500)

        await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ customAmount: 250 })

        const res = await request(app)
            .post('/api/v1/pushover/pushover')
            .set(authHeader(token))
            .send()

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.data.pushoverAmount).toBe(250)
        expect(res.body.data.data.pushoverBaseline).toBe(250)

        const saver = await Saver.findOne({ userId })
        expect(saver?.saverAmount).toBe(0)
        expect(saver?.pushoverAmount).toBe(250)

        const pushovers = await Pushover.find({ userId })
        expect(pushovers).toHaveLength(1)
        expect(pushovers[0].pushoverAmount).toBe(250)
    })

    it('rejects rollover when saver balance is zero', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 500)

        const res = await request(app)
            .post('/api/v1/pushover/pushover')
            .set(authHeader(token))
            .send()

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/no saver balance/i)
    })
})
