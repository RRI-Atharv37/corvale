import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, getAccessToken, http, onSessionEnded, refreshSession, setAccessToken } from '../api'

/**
 * The admin session lives in memory only. Access token: a module variable, never browser storage. Refresh:
 * an httpOnly cookie the page cannot read. A 401 triggers exactly one shared refresh, and a failed refresh ends
 * the session instead of looping.
 */

interface Call {
  method: string
  url: string
  authorization?: string
  withCredentials?: boolean
}

let calls: Call[]
let handler: (call: Call) => { status: number; data: unknown }

const reply = (config: InternalAxiosRequestConfig, status: number, data: unknown) => ({
  data,
  status,
  statusText: String(status),
  headers: {},
  config,
})

const SESSION = { accessToken: 'fresh', expiresInSeconds: 600, admin: { id: '1', email: 'a@b.co', role: 'owner' } }

beforeEach(() => {
  calls = []
  handler = () => ({ status: 200, data: { success: true, data: {} } })
  http.defaults.adapter = async (config) => {
    const call: Call = {
      method: (config.method ?? 'get').toLowerCase(),
      url: config.url ?? '',
      authorization: (config.headers as unknown as Record<string, string | undefined>).Authorization,
      withCredentials: config.withCredentials,
    }
    calls.push(call)
    const { status, data } = handler(call)
    const response = reply(config, status, data)
    if (status >= 400) {
      throw Object.assign(new Error(`status ${status}`), { isAxiosError: true, response, config })
    }
    return response
  }
  setAccessToken(null)
  onSessionEnded(null)
})

afterEach(() => {
  setAccessToken(null)
  onSessionEnded(null)
})

const ok = (data: unknown) => ({ status: 200, data: { success: true, data } })
const fail = (status: number, message: string) => ({ status, data: { success: false, statusCode: status, message } })

describe('token handling', () => {
  it('keeps the access token in memory and nowhere the page can persist it', async () => {
    handler = () => ok({ ...SESSION, accessToken: 'secret.access.token', stepUpUntil: null })

    await api.login({ email: 'a@b.co', password: 'x'.repeat(14), totpCode: '123456' })

    expect(getAccessToken()).toBe('secret.access.token')
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret.access.token')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret.access.token')
    expect(document.cookie).not.toContain('secret.access.token')
  })

  it('sends the bearer token on later requests, and never on the login call itself', async () => {
    setAccessToken('t-1')
    await api.me()
    await api.login({ email: 'a@b.co', password: 'x'.repeat(14), totpCode: '123456' }).catch(() => undefined)

    expect(calls[0].authorization).toBe('Bearer t-1')
    expect(calls[1].authorization).toBeUndefined()
  })

  it('always sends credentials so the refresh cookie travels', async () => {
    await api.me()

    expect(calls.every((call) => call.withCredentials === true)).toBe(true)
  })
})

describe('refresh on 401', () => {
  it('refreshes once and retries the original request with the new token', async () => {
    setAccessToken('expired')
    handler = (call) => {
      if (call.url === '/auth/refresh') return ok(SESSION)
      return call.authorization === 'Bearer fresh' ? ok({ ok: true }) : fail(401, 'Admin session is invalid or has expired')
    }

    const result = await http.get('/subscribers')

    expect(result.data.data).toEqual({ ok: true })
    expect(getAccessToken()).toBe('fresh')
    expect(calls.map((call) => call.url)).toEqual(['/subscribers', '/auth/refresh', '/subscribers'])
  })

  it('shares a single refresh between concurrent 401s', async () => {
    setAccessToken('expired')
    handler = (call) => {
      if (call.url === '/auth/refresh') return ok(SESSION)
      return call.authorization === 'Bearer fresh' ? ok({}) : fail(401, 'expired')
    }

    await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')])

    expect(calls.filter((call) => call.url === '/auth/refresh')).toHaveLength(1)
  })

  it('ends the session when the refresh fails, once, and rejects the request', async () => {
    const ended = vi.fn()
    onSessionEnded(ended)
    setAccessToken('expired')
    handler = (call) => (call.url === '/auth/refresh' ? fail(401, 'Admin session is invalid or has expired') : fail(401, 'expired'))

    await expect(Promise.all([http.get('/a'), http.get('/b')])).rejects.toBeTruthy()

    expect(getAccessToken()).toBeNull()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(calls.filter((call) => call.url === '/auth/refresh')).toHaveLength(1)
  })

  it('does not loop: a 401 after a successful refresh is returned as an error', async () => {
    setAccessToken('expired')
    handler = (call) => (call.url === '/auth/refresh' ? ok(SESSION) : fail(401, 'still no'))

    await expect(http.get('/a')).rejects.toBeTruthy()

    expect(calls.filter((call) => call.url === '/auth/refresh')).toHaveLength(1)
  })

  it('does not try to refresh when the login call itself is refused', async () => {
    handler = () => fail(401, 'Invalid credentials')

    await expect(api.login({ email: 'a@b.co', password: 'x'.repeat(14), totpCode: '000000' })).rejects.toMatchObject({
      message: 'Invalid credentials',
      status: 401,
    })

    expect(calls.map((call) => call.url)).toEqual(['/auth/login'])
  })
})

describe('refreshSession', () => {
  it('returns the session when the cookie is good and null when it is not, without ending anything', async () => {
    const ended = vi.fn()
    onSessionEnded(ended)
    handler = () => ok({ ...SESSION, admin: { ...SESSION.admin, role: 'support' } })
    expect((await refreshSession())?.admin.role).toBe('support')

    handler = () => fail(401, 'Admin session is invalid or has expired')
    expect(await refreshSession()).toBeNull()
    expect(ended).not.toHaveBeenCalled()
  })

  it('shares one call between overlapping refreshes (a double mount must not burn the cookie twice)', async () => {
    handler = () => ok(SESSION)

    await Promise.all([refreshSession(), refreshSession()])

    expect(calls.filter((call) => call.url === '/auth/refresh')).toHaveLength(1)
  })
})

describe('errors', () => {
  it('surfaces the server message and status', async () => {
    handler = () => fail(403, 'Your admin role does not allow this')

    const error = await api.opsHealth().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, message: 'Your admin role does not allow this' })
  })

  it('falls back to a plain message when the server sends none', async () => {
    handler = () => ({ status: 500, data: '<html>' })

    const error = await api.opsHealth().catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 500 })
    expect((error as Error).message.length).toBeGreaterThan(0)
  })
})
