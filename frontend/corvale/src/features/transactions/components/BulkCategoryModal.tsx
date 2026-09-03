import React from 'react'
import Modal from '@ui/Modal'
import CategoryPicker from '@features/categories/components/CategoryPicker'
import type { CategoriesResponse } from '@features/categories/types'

interface BulkCategoryModalProps {
    open: boolean
    onClose: () => void
    onSubmit: (e: React.FormEvent) => void
    selectedCount: number
    categoryId: string
    onCategoryIdChange: (categoryId: string) => void
    submitting: boolean
    categoriesData?: CategoriesResponse
}

const BulkCategoryModal = ({
    open,
    onClose,
    onSubmit,
    selectedCount,
    categoryId,
    onCategoryIdChange,
    submitting,
    categoriesData,
}: BulkCategoryModalProps) => {
    return (
        <Modal open={open} onClose={onClose} title="Change category" size="md">
            <form onSubmit={onSubmit} className="space-y-4">
                <p className="text-sm text-fg-muted">
                    Apply a new category to {selectedCount} selected transaction
                    {selectedCount === 1 ? '' : 's'}. Transfers are excluded.
                </p>
                <CategoryPicker
                    value={categoryId}
                    onChange={onCategoryIdChange}
                    categoriesData={categoriesData}
                    required
                    disabled={submitting}
                />
                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={submitting || !categoryId}
                        className="flex-1 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                    >
                        {submitting ? 'Updating...' : 'Update category'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

export default BulkCategoryModal
