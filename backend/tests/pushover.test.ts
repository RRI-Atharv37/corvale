import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Saver from '../models/Saver'
import Pushover from '../models/Pushover'
import { authHeader, registerUser } from './helpers'

describe('Pushover', () => {
    it('creates snapshot and resets saver balance on rollover', async () => {
        const { token, userId } = await registerUser(app)

        await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ remainingBalance: 500, customAmount: 250 })

        const res = await request(app)
            .post('/api/v1/pushover/pushover')
            .set(authHeader(token))
            .send()

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.data.pushoverAmount).toBe(250)

        const saver = await Saver.findOne({ userId })
        expect(saver?.saverAmount).toBe(0)

        const pushovers = await Pushover.find({ userId })
        expect(pushovers).toHaveLength(1)
        expect(pushovers[0].pushoverAmount).toBe(250)
    })
})
