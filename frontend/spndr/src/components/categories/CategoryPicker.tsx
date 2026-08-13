import React, { useCallback, useMemo } from 'react'
import { CategoryIcon } from '../../utils/categoryIcons'
import { useAsyncData } from '../../hooks/useAsyncData'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type { ApiResponse, CategoriesResponse, Category } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'

export interface CategoryPickerProps {
    value: string
    onChange: (categoryId: string) => void
    masterCategoryId?: string
    label?: string
    required?: boolean
    disabled?: boolean
    categoriesData?: CategoriesResponse
}

export interface CategoryGroup {
    master: Category
    subs: Category[]
}

export const groupCategoriesByMaster = (
    masters: Category[],
    userCategories: Category[]
): CategoryGroup[] => {
    return masters.map((master) => ({
        master,
        subs: userCategories
            .filter((category) => category.masterCategoryId === master._id)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    }))
}

export const flattenCategoryOrder = (groups: CategoryGroup[]): string[] => {
    return groups.flatMap((group) => group.subs.map((sub) => sub._id))
}

const CategoryPicker: React.FC<CategoryPickerProps> = ({
    value,
    onChange,
    masterCategoryId,
    label = 'Category',
    required,
    disabled,
    categoriesData,
}) => {
    const fetchCategories = useCallback(async (): Promise<CategoriesResponse> => {
        try {
            const response = await axiosInstance.get<ApiResponse<CategoriesResponse>>(
                API_PATHS.CATEGORIES.GET_ALL
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load categories'))
        }
    }, [])

    const { data, loading, error } = useAsyncData(fetchCategories, [fetchCategories])

    const categories = categoriesData ?? data
    const isLoading = !categoriesData && loading
    const loadError = !categoriesData ? error : null

    const groups = useMemo(() => {
        if (!categories) return []
        const allGroups = groupCategoriesByMaster(categories.masters, categories.userCategories)
        if (masterCategoryId) {
            return allGroups.filter((group) => group.master._id === masterCategoryId)
        }
        return allGroups
    }, [categories, masterCategoryId])

    if (isLoading) {
        return (
            <div>
                <label className="text-[13px] text-fg-secondary">{label}</label>
                <p className="text-xs text-fg-muted mt-2">Loading categories...</p>
            </div>
        )
    }

    if (loadError) {
        return (
            <div>
                <label className="text-[13px] text-fg-secondary">{label}</label>
                <p className="text-xs text-expense mt-2">{loadError}</p>
            </div>
        )
    }

    if (!categories) return null

    return (
        <div>
            <label className="text-[13px] text-fg-secondary">
                {label}
                {required && <span className="text-expense ml-0.5">*</span>}
            </label>
            <div className="input-box mb-0 mt-1">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    required={required}
                    disabled={disabled}
                    className="w-full bg-transparent outline-none text-fg"
                >
                    <option value="" className="bg-surface">
                        Select a category
                    </option>
                    {groups.map((group) => (
                        <optgroup key={group.master._id} label={group.master.name} className="bg-surface">
                            <option value={group.master._id} className="bg-surface">
                                {group.master.name} (master)
                            </option>
                            {group.subs.map((sub) => (
                                <option key={sub._id} value={sub._id} className="bg-surface">
                                    {sub.name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </div>
            {value && (
                <div className="flex items-center gap-2 mt-2">
                    {(() => {
                        const selected =
                            categories.masters.find((m) => m._id === value) ??
                            categories.userCategories.find((c) => c._id === value)
                        if (!selected) return null
                        return (
                            <>
                                <span
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border"
                                    style={{ backgroundColor: `${selected.color ?? '#6B7280'}20` }}
                                >
                                    <CategoryIcon
                                        icon={selected.icon}
                                        color={selected.color}
                                        size={14}
                                    />
                                </span>
                                <span className="text-xs text-fg-muted">{selected.name}</span>
                            </>
                        )
                    })()}
                </div>
            )}
        </div>
    )
}

export default CategoryPicker
