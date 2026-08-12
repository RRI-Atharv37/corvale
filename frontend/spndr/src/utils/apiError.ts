import { AxiosError } from 'axios'

interface ApiErrorBody {
    message?: string
    success?: boolean
}

export const getApiErrorMessage = (error: unknown, fallback = 'Something went wrong. Please try again.'): string => {
    if (error instanceof AxiosError) {
        const data = error.response?.data as ApiErrorBody | undefined
        if (data?.message) {
            return data.message
        }
    }

    if (error instanceof Error && error.message) {
        return error.message
    }

    return fallback
}
