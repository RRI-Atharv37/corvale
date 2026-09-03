import React from 'react'
import Pagination from '@ui/Pagination'
import { usePaginatedList } from '../hooks/usePaginatedList'

interface PaginatedCardListProps<T> {
    items: T[]
    pageSize: number
    children: (paginatedItems: T[]) => React.ReactNode
}

const PaginatedCardList = <T,>({ items, pageSize, children }: PaginatedCardListProps<T>) => {
    const { paginatedItems, page, setPage, totalPages, totalItems } = usePaginatedList(items, pageSize)

    return (
        <>
            {children(paginatedItems)}
            <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                onPageChange={setPage}
            />
        </>
    )
}

export default PaginatedCardList
