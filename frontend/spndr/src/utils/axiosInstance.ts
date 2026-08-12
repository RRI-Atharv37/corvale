import axios, { AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'
import { BASE_URL } from './apiPaths'

const client = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    },
    withCredentials: true,
})

interface RetryableRequest extends InternalAxiosRequestConfig {
    _retry?: boolean
}

let isRefreshing = false
let refreshQueue: Array<(token: string | null) => void> = []

const processRefreshQueue = (token: string | null): void => {
    refreshQueue.forEach((callback) => callback(token))
    refreshQueue = []
}

const isAuthMutationRoute = (url?: string): boolean => {
    if (!url) return false
    return (
        url.includes('/auth/login') ||
        url.includes('/auth/register') ||
        url.includes('/auth/refresh') ||
        url.includes('/auth/password-reset')
    )
}

const shouldAttemptRefresh = (message: unknown): boolean => {
    if (typeof message !== 'string') return false
    return message.includes('expired') || message.includes('revoked')
}

client.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        if (config.data instanceof FormData) {
            delete config.headers['Content-Type']
        }
        return config
    },
    (error) => Promise.reject(error)
)

client.interceptors.response.use(
    (response) => response.data,
    async (error) => {
        const originalRequest = error.config as RetryableRequest | undefined
        const status = error.response?.status
        const message = error.response?.data?.message

        if (
            status === 401 &&
            originalRequest &&
            !originalRequest._retry &&
            !isAuthMutationRoute(originalRequest.url) &&
            shouldAttemptRefresh(message)
        ) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    refreshQueue.push((token) => {
                        if (!token) {
                            reject(error)
                            return
                        }
                        originalRequest.headers.Authorization = `Bearer ${token}`
                        resolve(client(originalRequest))
                    })
                })
            }

            originalRequest._retry = true
            isRefreshing = true

            try {
                const refreshResponse = await axios.post(
                    `${BASE_URL}/auth/refresh`,
                    {},
                    { withCredentials: true }
                )
                const newToken = refreshResponse.data?.data?.token as string | undefined

                if (!newToken) {
                    throw new Error('Refresh response missing token')
                }

                localStorage.setItem('token', newToken)
                processRefreshQueue(newToken)
                originalRequest.headers.Authorization = `Bearer ${newToken}`
                return client(originalRequest)
            } catch (refreshError) {
                processRefreshQueue(null)
                localStorage.removeItem('token')
                return Promise.reject(refreshError)
            } finally {
                isRefreshing = false
            }
        }

        if (status === 401 && !isAuthMutationRoute(originalRequest?.url)) {
            localStorage.removeItem('token')
        }

        return Promise.reject(error)
    }
)

/** Axios instance whose interceptors unwrap `response.data` - methods return `T` directly. */
export interface ApiClient {
    get<T>(url: string, config?: AxiosRequestConfig): Promise<T>
    post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
    put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
    patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
    delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>
}

const axiosInstance = client as unknown as ApiClient

export default axiosInstance
