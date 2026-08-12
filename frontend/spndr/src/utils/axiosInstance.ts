import axios, { AxiosRequestConfig } from 'axios'
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
    (error) => {
        if (error.response?.status === 401) {
            const isAuthRoute =
                error.config?.url?.includes('/auth/login') ||
                error.config?.url?.includes('/auth/register')

            if (!isAuthRoute) {
                localStorage.removeItem('token')
            }
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
