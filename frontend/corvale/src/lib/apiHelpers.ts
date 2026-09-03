import { ApiResponse } from './types/api'

export const unwrapApiData = <T>(response: ApiResponse<T> | T): T => {
    if (response && typeof response === 'object' && 'success' in response && 'data' in response) {
        return (response as ApiResponse<T>).data
    }

    return response as T
}
