import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CategoryIcon } from '@lib/categoryIcons'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import type { ApiResponse } from '@lib/types/api'
import type { CategoriesResponse, Category } from '@features/categories/types'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'

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

interface VisibleGroup {
    master: Category
    /** Whether the master itself is offered as a selectable option in this (possibly filtered) view.
     * Suppressed when a search term matches only some subs, so the list shows just those. */
    showMasterOption: boolean
    subs: Category[]
}

/**
 * ARIA 1.2 editable combobox over the category tree (V4). Replaces the native `<select>` +
 * `<optgroup>` that rendered every master twice (group label + a `"(master)"` option).
 *
 * Contract preserved for all 9 call sites:
 * - props are byte-identical to the old component;
 * - `groupCategoriesByMaster` / `flattenCategoryOrder` are still exported (`Categories.tsx`);
 * - a master category is still selectable (its own `role="option"`, keyboard-reachable), so budgets
 *   and categorization rules that target a master keep working.
 *
 * Behaviour notes:
 * - `Enter` while the listbox is open is swallowed (`preventDefault`) so it never submits the
 *   enclosing form;
 * - `Escape` while open closes only the listbox (`stopPropagation`) so an enclosing modal survives
 *   the first press;
 * - the listbox expands in normal flow (no absolute positioning / portal) because 6 of the 9 call
 *   sites live inside a modal body that clips both axes.
 */
const CategoryPicker: React.FC<CategoryPickerProps> = ({
    value,
    onChange,
    masterCategoryId,
    label = 'Category',
    required,
    disabled,
    categoriesData,
}) => {
    const baseId = useId()
    const inputId = `${baseId}-input`
    const listboxId = `${baseId}-listbox`
    const optionDomId = (categoryId: string) => `${baseId}-opt-${categoryId}`

    const inputRef = useRef<HTMLInputElement>(null)

    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [dirty, setDirty] = useState(false)
    const [activeId, setActiveId] = useState('')

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

    const groups = useMemo<CategoryGroup[]>(() => {
        if (!categories) return []
        const allGroups = groupCategoriesByMaster(categories.masters, categories.userCategories)
        if (masterCategoryId) {
            return allGroups.filter((group) => group.master._id === masterCategoryId)
        }
        return allGroups
    }, [categories, masterCategoryId])

    const selected = useMemo<Category | null>(() => {
        if (!categories || !value) return null
        return (
            categories.masters.find((category) => category._id === value) ??
            categories.userCategories.find((category) => category._id === value) ??
            null
        )
    }, [categories, value])

    const visibleGroups = useMemo<VisibleGroup[]>(() => {
        const q = dirty ? query.trim().toLowerCase() : ''
        const result: VisibleGroup[] = []
        for (const group of groups) {
            if (!q) {
                result.push({ master: group.master, showMasterOption: true, subs: group.subs })
                continue
            }
            const masterMatch = group.master.name.toLowerCase().includes(q)
            if (masterMatch) {
                result.push({ master: group.master, showMasterOption: true, subs: group.subs })
                continue
            }
            const matchedSubs = group.subs.filter((sub) => sub.name.toLowerCase().includes(q))
            if (matchedSubs.length > 0) {
                result.push({ master: group.master, showMasterOption: false, subs: matchedSubs })
            }
        }
        return result
    }, [groups, query, dirty])

    const navigableIds = useMemo(() => {
        const ids: string[] = []
        for (const group of visibleGroups) {
            if (group.showMasterOption) ids.push(group.master._id)
            for (const sub of group.subs) ids.push(sub._id)
        }
        return ids
    }, [visibleGroups])

    // Keep the active option valid as the filtered list changes under the user.
    useEffect(() => {
        if (!open) return
        if (activeId && !navigableIds.includes(activeId)) {
            setActiveId(navigableIds[0] ?? '')
        }
    }, [open, navigableIds, activeId])

    // Keep the active option scrolled into view within the in-flow listbox.
    useEffect(() => {
        if (!open || !activeId) return
        const el =
            typeof document !== 'undefined'
                ? document.getElementById(`${baseId}-opt-${activeId}`)
                : null
        el?.scrollIntoView?.({ block: 'nearest' })
    }, [open, activeId, baseId])

    const closeList = useCallback(() => {
        setOpen(false)
        setDirty(false)
        setQuery('')
    }, [])

    const selectOption = useCallback(
        (categoryId: string) => {
            onChange(categoryId)
            setOpen(false)
            setDirty(false)
            setQuery('')
            setActiveId(categoryId)
            inputRef.current?.focus()
        },
        [onChange]
    )

    const moveActive = (delta: number) => {
        setActiveId((current) => {
            if (navigableIds.length === 0) return ''
            const idx = navigableIds.indexOf(current)
            if (idx === -1) {
                return delta > 0 ? navigableIds[0] : navigableIds[navigableIds.length - 1]
            }
            const next = Math.min(Math.max(idx + delta, 0), navigableIds.length - 1)
            return navigableIds[next]
        })
    }

    const openList = (edge: 'first' | 'last') => {
        setOpen(true)
        setDirty(false)
        if (value && navigableIds.includes(value)) {
            setActiveId(value)
        } else {
            setActiveId(
                edge === 'first'
                    ? navigableIds[0] ?? ''
                    : navigableIds[navigableIds.length - 1] ?? ''
            )
        }
    }

    const handleFocus = () => {
        if (disabled) return
        setOpen(true)
        setDirty(false)
        setActiveId(value && navigableIds.includes(value) ? value : '')
        inputRef.current?.select()
    }

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value)
        setDirty(true)
        setOpen(true)
    }

    const handleBlur = () => {
        // Options `preventDefault` on `mousedown`, so a click on an option never blurs the input.
        // This only fires on a genuine focus-out (Tab, clicking elsewhere).
        setOpen(false)
        setDirty(false)
        setQuery('')
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault()
                if (open) moveActive(1)
                else openList('first')
                break
            case 'ArrowUp':
                event.preventDefault()
                if (open) moveActive(-1)
                else openList('last')
                break
            case 'Enter':
                if (open) {
                    // Critical: without this the keypress submits the enclosing form at every call site.
                    event.preventDefault()
                    if (activeId) selectOption(activeId)
                    else closeList()
                }
                break
            case 'Escape':
                if (open) {
                    event.preventDefault()
                    // Critical: without this the first Escape closes the enclosing modal, not the list.
                    event.stopPropagation()
                    closeList()
                }
                break
            case 'Tab':
                if (open) closeList()
                break
            default:
                break
        }
    }

    if (isLoading) {
        return (
            <div>
                <label htmlFor={inputId} className="text-[13px] text-fg-secondary">{label}</label>
                <p role="status" aria-live="polite" className="text-xs text-fg-muted mt-2">Loading categories...</p>
            </div>
        )
    }

    if (loadError) {
        return (
            <div>
                <label htmlFor={inputId} className="text-[13px] text-fg-secondary">{label}</label>
                <p className="text-xs text-expense mt-2">{loadError}</p>
            </div>
        )
    }

    if (!categories) return null

    const inputValue = open && dirty ? query : selected?.name ?? ''

    const optionClassName = (categoryId: string, isMaster: boolean): string =>
        [
            'flex cursor-pointer items-center gap-2 px-4 text-sm',
            isMaster ? 'py-1.5' : 'py-2 pl-6',
            activeId === categoryId ? 'bg-accent/10' : '',
            value === categoryId ? 'text-accent' : 'text-fg',
        ]
            .filter(Boolean)
            .join(' ')

    return (
        <div>
            <label htmlFor={inputId} className="text-[13px] text-fg-secondary">
                {label}
                {required && <span aria-hidden="true" className="text-expense ml-0.5">*</span>}
            </label>
            <div className="relative mt-1">
                <div className="input-box mb-0">
                    <input
                        ref={inputRef}
                        id={inputId}
                        type="text"
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={listboxId}
                        aria-autocomplete="list"
                        aria-activedescendant={open && activeId ? optionDomId(activeId) : undefined}
                        autoComplete="off"
                        required={required}
                        disabled={disabled}
                        value={inputValue}
                        placeholder="Select a category"
                        onChange={handleChange}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        className="w-full bg-transparent outline-none text-fg placeholder:text-fg-muted"
                    />
                </div>
                {open && (
                    <ul
                        id={listboxId}
                        role="listbox"
                        aria-label={label}
                        className="scroll-area mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border-subtle bg-elevated py-1"
                        onMouseDown={(event) => event.preventDefault()}
                    >
                        {navigableIds.length === 0 && (
                            <li role="presentation" className="px-4 py-2 text-xs text-fg-muted">
                                No matching categories
                            </li>
                        )}
                        {visibleGroups.map((group) => (
                            <li key={group.master._id} role="group" aria-label={group.master.name}>
                                <div
                                    role="presentation"
                                    aria-hidden="true"
                                    className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted"
                                >
                                    {group.master.name}
                                </div>
                                {group.showMasterOption && (
                                    <div
                                        role="option"
                                        id={optionDomId(group.master._id)}
                                        aria-selected={value === group.master._id}
                                        onClick={() => selectOption(group.master._id)}
                                        className={optionClassName(group.master._id, true)}
                                    >
                                        <span className="truncate font-medium">{group.master.name}</span>
                                        <span className="sr-only"> (master category)</span>
                                    </div>
                                )}
                                {group.subs.map((sub) => (
                                    <div
                                        key={sub._id}
                                        role="option"
                                        id={optionDomId(sub._id)}
                                        aria-selected={value === sub._id}
                                        onClick={() => selectOption(sub._id)}
                                        className={optionClassName(sub._id, false)}
                                    >
                                        <span className="truncate">{sub.name}</span>
                                    </div>
                                ))}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {!open && selected && (
                <div className="flex items-center gap-2 mt-2">
                    <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border"
                        style={{ backgroundColor: `${selected.color ?? '#6B7280'}20` }}
                    >
                        <CategoryIcon icon={selected.icon} color={selected.color} size={14} />
                    </span>
                    <span className="text-xs text-fg-muted">{selected.name}</span>
                </div>
            )}
        </div>
    )
}

export default CategoryPicker
