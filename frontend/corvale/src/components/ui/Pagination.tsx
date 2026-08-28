import React from 'react'
import { IoChevronBack, IoChevronForward } from 'react-icons/io5'

interface PaginationProps {
    page: number
    totalPages: number
    onPageChange: (page: number) => void
    totalItems?: number
}

const Pagination: React.FC<PaginationProps> = ({ page, totalPages, onPageChange, totalItems }) => {
    if (totalPages <= 1) return null

    return (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border-subtle">
            <p className="text-xs text-fg-muted">
                Page {page} of {totalPages}
                {totalItems !== undefined && ` · ${totalItems} total`}
            </p>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-fg-secondary hover:border-accent/30 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    <IoChevronBack size={14} />
                    Prev
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-fg-secondary hover:border-accent/30 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Next
                    <IoChevronForward size={14} />
                </button>
            </div>
        </div>
    )
}

export default Pagination
