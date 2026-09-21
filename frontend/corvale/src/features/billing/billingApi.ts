import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { unwrapApiData } from '@lib/apiHelpers'
import { isAllowedExternalUrl } from '@lib/safeExternalUrl'
import type { ApiResponse, User } from '@lib/types/api'
import { getDeviceIdentity } from '@platform/sync/deviceIdentity'
import type { BillingOverview, Invoice, PlanSelection, PublicPlans, SyncDevices } from './types'

const get = async <T>(path: string): Promise<T> => unwrapApiData(await axiosInstance.get<ApiResponse<T>>(path))

const post = async <T>(path: string, body: object = {}): Promise<T> =>
    unwrapApiData(await axiosInstance.post<ApiResponse<T>>(path, body))

/** A hosted page is only ever handed to the browser if it is a real web URL. */
const hostedUrl = async (path: string, body?: object): Promise<string> => {
    const { url } = await post<{ url: string }>(path, body)
    if (typeof url !== 'string' || !url.startsWith('https://') || !isAllowedExternalUrl(url)) {
        throw new Error('Billing page could not open. Try again in a moment.')
    }
    return url
}

export const fetchPublicPlans = (): Promise<PublicPlans> => get<PublicPlans>(API_PATHS.BILLING.PLANS)

export const fetchBillingOverview = (): Promise<BillingOverview> => get<BillingOverview>(API_PATHS.BILLING.OVERVIEW)

export const fetchInvoices = async (): Promise<Invoice[]> => (await get<{ invoices: Invoice[] }>(API_PATHS.BILLING.INVOICES)).invoices

export const startCheckout = ({ planCode, interval }: PlanSelection): Promise<string> =>
    hostedUrl(API_PATHS.BILLING.CHECKOUT, { planCode, interval })

export const openBillingPortal = (): Promise<string> => hostedUrl(API_PATHS.BILLING.PORTAL)

/** These only ask. The plan changes in the app when the provider's webhook reaches the server. */
export const requestPlanChange = async ({ planCode, interval }: PlanSelection): Promise<void> => {
    await post(API_PATHS.BILLING.CHANGE_PLAN, { planCode, interval })
}

export const requestCancellation = async (): Promise<void> => {
    await post(API_PATHS.BILLING.CANCEL)
}

export const requestResume = async (): Promise<void> => {
    await post(API_PATHS.BILLING.RESUME)
}

/** Sends this install's id so the server can say which row is this device. */
export const fetchDevices = async (): Promise<SyncDevices> =>
    unwrapApiData(
        await axiosInstance.get<ApiResponse<SyncDevices>>(API_PATHS.BILLING.DEVICES, { params: { deviceId: getDeviceIdentity().deviceId } })
    )

const devicePath = (deviceId: string): string => `${API_PATHS.BILLING.DEVICES}/${encodeURIComponent(deviceId)}`

export const revokeDevice = async (deviceId: string): Promise<void> => {
    await axiosInstance.delete(devicePath(deviceId))
}

/** `null` clears the name. */
export const renameDevice = async (deviceId: string, name: string | null): Promise<void> => {
    await axiosInstance.patch(devicePath(deviceId), { name })
}

export const fetchCurrentUser = (): Promise<User> => get<User>(API_PATHS.AUTH.USER)
