import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'

import type {
  AdminListItem,
  AuditResponse,
  EnrolStart,
  EnrolmentGrant,
  GrandfatherBatchView,
  GrandfatherCohortPreview,
  GrandfatherCohortReport,
  MeResponse,
  Meta,
  MetricsOverview,
  OpsHealth,
  ProviderInvoiceView,
  ResyncDiff,
  Session,
  SubscriberDetail,
  SubscriberFilters,
  SubscriberListResponse,
} from './types'

export const STEP_UP_REQUIRED_MESSAGE = 'Confirm with a fresh authenticator code to continue'
export const STEP_UP_DISABLED_MESSAGE = 'Sensitive actions are disabled for 24 hours after your authenticator was reset'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const baseURL = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:5000/api/v1/admin'

export const http = axios.create({ baseURL, withCredentials: true, headers: { 'Content-Type': 'application/json' } })

/**
 * The access token lives in this module variable and nowhere else: not localStorage, not sessionStorage, not a
 * cookie. Reloading the page drops it, and the httpOnly refresh cookie (which the page cannot read) buys a new one.
 */
let accessToken: string | null = null
let sessionEndedNotified = false
let sessionEnded: (() => void) | null = null

export const getAccessToken = (): string | null => accessToken

export const setAccessToken = (token: string | null): void => {
  accessToken = token
  if (token !== null) sessionEndedNotified = false
}

export const onSessionEnded = (callback: (() => void) | null): void => {
  sessionEnded = callback
}

const notifySessionEnded = (): void => {
  if (sessionEndedNotified) return
  sessionEndedNotified = true
  sessionEnded?.()
}

const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/enrol/start', '/auth/enrol/complete']
const isAuthPath = (url: string | undefined): boolean => AUTH_PATHS.includes(url ?? '')

const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0
    const body = error.response?.data as { message?: unknown } | undefined
    const message = typeof body?.message === 'string' && body.message !== '' ? body.message : status ? `Request failed (${status})` : 'The admin API could not be reached'
    return new ApiError(message, status)
  }
  return new ApiError(error instanceof Error ? error.message : 'Unexpected error', 0)
}

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken && !isAuthPath(config.url)) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config) throw toApiError(error)

    const config = error.config as RetriableConfig
    if (config._retried || isAuthPath(config.url)) throw toApiError(error)

    const session = await refreshSession()
    if (!session) {
      setAccessToken(null)
      notifySessionEnded()
      throw toApiError(error)
    }

    config._retried = true
    config.headers.Authorization = `Bearer ${session.accessToken}`
    return http.request(config)
  }
)

let refreshing: Promise<Session | null> | null = null

/** One refresh at a time: overlapping callers (a double mount, several 401s) share it, so the rotating cookie is spent once. */
export const refreshSession = (): Promise<Session | null> => {
  refreshing ??= http
    .post<{ data: Session }>('/auth/refresh')
    .then((response) => {
      setAccessToken(response.data.data.accessToken)
      return response.data.data
    })
    .catch(() => {
      setAccessToken(null)
      return null
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

const data = <T>(response: AxiosResponse<{ data: T }>): T => response.data.data

const cleanParams = (params: object): Record<string, string | number> =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')) as Record<string, string | number>

export const api = {
  async login(input: { email: string; password: string; totpCode?: string; recoveryCode?: string }): Promise<Session> {
    const session = data(await http.post<{ data: Session }>('/auth/login', input))
    setAccessToken(session.accessToken)
    return session
  },
  async logout(): Promise<void> {
    try {
      await http.post('/auth/logout')
    } finally {
      setAccessToken(null)
    }
  },
  async me(): Promise<MeResponse> {
    return data(await http.get<{ data: MeResponse }>('/auth/me'))
  },
  async stepUp(totpCode: string): Promise<{ stepUpUntil: string }> {
    return data(await http.post<{ data: { stepUpUntil: string } }>('/auth/step-up', { totpCode }))
  },
  async enrolStart(token: string): Promise<EnrolStart> {
    return data(await http.post<{ data: EnrolStart }>('/auth/enrol/start', { token }))
  },
  async enrolComplete(input: { token: string; password?: string; totpCode: string }): Promise<{ recoveryCodes: string[] }> {
    return data(await http.post<{ data: { recoveryCodes: string[] } }>('/auth/enrol/complete', input))
  },
  async meta(): Promise<Meta> {
    return data(await http.get<{ data: Meta }>('/meta'))
  },
  async lookup(q: string): Promise<{ subscribers: SubscriberListResponse['subscribers'] }> {
    return data(await http.get<{ data: { subscribers: SubscriberListResponse['subscribers'] } }>('/subscribers/lookup', { params: { q } }))
  },
  async listSubscribers(filters: SubscriberFilters): Promise<SubscriberListResponse> {
    return data(await http.get<{ data: SubscriberListResponse }>('/subscribers', { params: cleanParams(filters) }))
  },
  async getSubscriber(userId: string): Promise<SubscriberDetail> {
    return data(await http.get<{ data: SubscriberDetail }>(`/subscribers/${userId}`))
  },
  async opsHealth(): Promise<OpsHealth> {
    return data(await http.get<{ data: OpsHealth }>('/ops/health'))
  },
  async audit(params: { page: number; limit?: number; action?: string; subjectUserId?: string; adminId?: string }): Promise<AuditResponse> {
    return data(await http.get<{ data: AuditResponse }>('/audit', { params: cleanParams(params) }))
  },
  async listAdmins(): Promise<{ admins: AdminListItem[] }> {
    return data(await http.get<{ data: { admins: AdminListItem[] } }>('/admins'))
  },
  async invite(body: { email: string; role: string; reason: string }): Promise<EnrolmentGrant> {
    return data(await http.post<{ data: EnrolmentGrant }>('/admins/invite', body))
  },
  async resetTotp(adminId: string, body: { reason: string }): Promise<EnrolmentGrant> {
    return data(await http.post<{ data: EnrolmentGrant }>(`/admins/${adminId}/reset-totp`, body))
  },
  async setAdminStatus(adminId: string, body: { status: 'active' | 'disabled'; reason: string }): Promise<AdminListItem> {
    return data(await http.patch<{ data: AdminListItem }>(`/admins/${adminId}`, body))
  },
  async grant(userId: string, body: Record<string, unknown>): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/subscribers/${userId}/grant`, body))
  },
  async revokeGrant(userId: string, body: { reason: string }): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/subscribers/${userId}/grant/revoke`, body))
  },
  async extendTrial(userId: string, body: { days: number; reason: string }): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/subscribers/${userId}/trial-extension`, body))
  },
  async setErasureHold(userId: string, body: { days: number; reason: string }): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/subscribers/${userId}/erasure-hold`, body))
  },
  async clearErasureHold(userId: string, body: { reason: string }): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/subscribers/${userId}/erasure-hold/clear`, body))
  },
  async setGrandfather(userId: string, body: { kind: string; reason: string }): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/subscribers/${userId}/grandfather`, body))
  },
  async revokeGrandfather(userId: string, body: { reason: string }): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/subscribers/${userId}/grandfather/revoke`, body))
  },
  async previewGrandfatherCohort(body: { kind: string; registeredBefore: string }): Promise<GrandfatherCohortPreview> {
    return data(await http.post<{ data: GrandfatherCohortPreview }>('/grandfather/cohort/dry-run', body))
  },
  async applyGrandfatherCohort(body: { kind: string; registeredBefore: string; confirmCount: number; reason: string }): Promise<{ batchId: string; appliedCount: number }> {
    return data(await http.post<{ data: { batchId: string; appliedCount: number } }>('/grandfather/cohort/apply', body))
  },
  async listGrandfatherBatches(): Promise<{ batches: GrandfatherBatchView[] }> {
    return data(await http.get<{ data: { batches: GrandfatherBatchView[] } }>('/grandfather/cohort/batches'))
  },
  async revertGrandfatherCohort(batchId: string, body: { reason: string }): Promise<{ batchId: string; revertedCount: number }> {
    return data(await http.post<{ data: { batchId: string; revertedCount: number } }>(`/grandfather/cohort/${batchId}/revert`, body))
  },
  async listInvoices(userId: string): Promise<{ invoices: ProviderInvoiceView[] }> {
    return data(await http.get<{ data: { invoices: ProviderInvoiceView[] } }>(`/subscribers/${userId}/invoices`))
  },
  async refund(userId: string, body: { providerInvoiceId: string; confirmAmountMinor: number; reason: string }): Promise<{ requested: true }> {
    return data(await http.post<{ data: { requested: true } }>(`/subscribers/${userId}/refund`, body))
  },
  async cancelAtPeriodEnd(userId: string, body: { reason: string }): Promise<{ requested: true }> {
    return data(await http.post<{ data: { requested: true } }>(`/subscribers/${userId}/cancel`, body))
  },
  async cancelNow(userId: string, body: { reason: string }): Promise<{ requested: true }> {
    return data(await http.post<{ data: { requested: true } }>(`/subscribers/${userId}/cancel/now`, body))
  },
  async previewResync(userId: string): Promise<{ differences: ResyncDiff[] }> {
    return data(await http.get<{ data: { differences: ResyncDiff[] } }>(`/subscribers/${userId}/resync/preview`))
  },
  async applyResync(userId: string, body: { reason: string }): Promise<{ fields: string[] }> {
    return data(await http.post<{ data: { fields: string[] } }>(`/subscribers/${userId}/resync/apply`, body))
  },
  async recomputeUsage(userId: string, body: { reason: string }): Promise<{ recomputed: true; workspacesRecomputed: number }> {
    return data(await http.post<{ data: { recomputed: true; workspacesRecomputed: number } }>(`/subscribers/${userId}/recompute-usage`, body))
  },
  async revokeDevice(userId: string, deviceRef: string, body: { reason: string }): Promise<{ revoked: true }> {
    return data(await http.post<{ data: { revoked: true } }>(`/subscribers/${userId}/devices/${deviceRef}/revoke`, body))
  },
  async replayBillingEvent(eventId: string, body: { reason: string }): Promise<unknown> {
    return data(await http.post<{ data: unknown }>(`/billing-events/${eventId}/replay`, body))
  },
  async metricsOverview(days: number): Promise<MetricsOverview> {
    return data(await http.get<{ data: MetricsOverview }>('/metrics/overview', { params: { days } }))
  },
  async grandfatherCohortReport(): Promise<GrandfatherCohortReport> {
    return data(await http.get<{ data: GrandfatherCohortReport }>('/metrics/grandfather-cohort'))
  },
}
