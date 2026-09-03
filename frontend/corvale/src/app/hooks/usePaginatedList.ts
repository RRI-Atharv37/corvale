import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_PAGE_SIZE } from '@lib/userPreferences'
import { useUser } from '../providers/useUser'

interface PaginatedListResult<T> {
    page: number
    setPage: (page: number) => void
    totalPages: number
    paginatedItems: T[]
    totalItems: number
}

export const usePageSize = (): number => {
    const { user } = useUser()
    return user?.pageSize ?? DEFAULT_PAGE_SIZE
}

export const usePaginatedList = <T,>(items: T[], pageSize: number): PaginatedListResult<T> => {
    const [page, setPage] = useState(1)

    const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
    const safePage = Math.min(page, totalPages)

    useEffect(() => {
        setPage(1)
    }, [items.length, pageSize])

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages)
        }
    }, [page, totalPages])

    const paginatedItems = useMemo(
        () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
        [items, pageSize, safePage]
    )

    return {
        page: safePage,
        setPage,
        totalPages,
        paginatedItems,
        totalItems: items.length,
    }
}
