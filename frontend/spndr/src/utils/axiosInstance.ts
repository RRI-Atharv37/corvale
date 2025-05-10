import axios from 'axios'
import { BASE_URL } from './apiPaths'

const axiosInstance = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
    withCredentials: true,
})

axiosInstance.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token')
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`
        }
        return config
    },
    (error) => {
        return Promise.reject(error)
    }
)

axiosInstance.interceptors.response.use(
    (response) => {
        return response.data
    },
    (error) => {
        if (error.response) {
            const { status } = error.response

            if (status === 401) {
                localStorage.removeItem('token')
                window.location.href = '/login'
            }

            if (status === 403) {
                console.error('Access forbidden: You do not have permission to access this resource.')
            }

            if (status >= 500) {
                console.error('Server error:', error.response.data)
            }
        } else if (error.code === 'ECONNABORTED') {
            console.error('Request timeout: Please try again later.')
        } else {
            console.error('Network error or unexpected issue:', error.message)
        }

        return Promise.reject(error)
    }
)

export default axiosInstance
