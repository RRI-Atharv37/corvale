import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ApiResponse, Tag } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import TagChip from './TagChip'

export interface TagPickerProps {
    value: string[]
    onChange: (tags: string[]) => void
    label?: string
    disabled?: boolean
    tagsData?: Tag[]
    onTagsChange?: () => void
}

const normalizeTagName = (value: string): string => value.trim()

const TagPicker: React.FC<TagPickerProps> = ({
    value,
    onChange,
    label = 'Tags',
    disabled,
    tagsData,
    onTagsChange,
}) => {
    const [inputValue, setInputValue] = useState('')
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const fetchTags = useCallback(async (): Promise<Tag[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<Tag[]>>(API_PATHS.TAGS.GET_ALL)
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load tags'))
        }
    }, [])

    const { data, loading, error, refetch } = useAsyncData(fetchTags, [fetchTags])

    const tags = tagsData ?? data
    const isLoading = !tagsData && loading
    const loadError = !tagsData ? error : null

    const colorByName = useMemo(() => {
        const map = new Map<string, string>()
        for (const tag of tags ?? []) {
            map.set(tag.name.toLowerCase(), tag.color ?? '#6b7280')
            map.set(tag.name, tag.color ?? '#6b7280')
        }
        return map
    }, [tags])

    const selectedSet = useMemo(() => new Set(value.map((tag) => tag.toLowerCase())), [value])

    const suggestions = useMemo(() => {
        if (!tags) return []
        const query = inputValue.trim().toLowerCase()
        return tags
            .filter((tag) => !selectedSet.has(tag.name.toLowerCase()))
            .filter((tag) => !query || tag.name.toLowerCase().includes(query))
            .slice(0, 8)
    }, [tags, inputValue, selectedSet])

    const trimmedInput = normalizeTagName(inputValue)
    const canCreate =
        trimmedInput.length > 0 &&
        !selectedSet.has(trimmedInput.toLowerCase()) &&
        !tags?.some((tag) => tag.name.toLowerCase() === trimmedInput.toLowerCase())

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setDropdownOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const addTag = (tagName: string) => {
        const normalized = normalizeTagName(tagName)
        if (!normalized || selectedSet.has(normalized.toLowerCase())) {
            return
        }
        onChange([...value, normalized])
        setInputValue('')
        setDropdownOpen(false)
    }

    const removeTag = (tagName: string) => {
        onChange(value.filter((tag) => tag !== tagName))
    }

    const createTag = async () => {
        if (!canCreate || creating) return

        setCreating(true)
        try {
            const response = await axiosInstance.post<ApiResponse<Tag>>(API_PATHS.TAGS.CREATE, {
                name: trimmedInput,
            })
            const created = unwrapApiData(response)
            addTag(created.name)
            if (!tagsData) {
                await refetch()
            }
            onTagsChange?.()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create tag'))
        } finally {
            setCreating(false)
        }
    }

    const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault()
            if (canCreate) {
                await createTag()
                return
            }
            const exactMatch = tags?.find((tag) => tag.name.toLowerCase() === trimmedInput.toLowerCase())
            if (exactMatch) {
                addTag(exactMatch.name)
            }
            return
        }

        if (event.key === 'Backspace' && !inputValue && value.length > 0) {
            onChange(value.slice(0, -1))
        }

        if (event.key === 'Escape') {
            setDropdownOpen(false)
        }
    }

    if (isLoading) {
        return (
            <div>
                <label className="text-[13px] text-fg-secondary">{label}</label>
                <p className="text-xs text-fg-muted mt-2">Loading tags...</p>
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

    return (
        <div ref={containerRef}>
            <label className="text-[13px] text-fg-secondary">{label}</label>
            <div
                className={[
                    'input-box mb-0 mt-1 min-h-[42px] flex flex-wrap items-center gap-1.5 px-2 py-1.5',
                    disabled ? 'opacity-60' : '',
                ].join(' ')}
            >
                {value.map((tag) => (
                    <TagChip
                        key={tag}
                        name={tag}
                        color={colorByName.get(tag) ?? colorByName.get(tag.toLowerCase())}
                        onRemove={disabled ? undefined : () => removeTag(tag)}
                    />
                ))}
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value)
                        setDropdownOpen(true)
                    }}
                    onFocus={() => setDropdownOpen(true)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled || creating}
                    placeholder={value.length === 0 ? 'Search or create tags...' : 'Add tag...'}
                    className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-fg placeholder:text-fg-muted"
                />
            </div>

            {dropdownOpen && !disabled && (suggestions.length > 0 || canCreate) && (
                <div className="relative z-20">
                    <div className="absolute left-0 right-0 mt-1 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
                        {suggestions.map((tag) => (
                            <button
                                key={tag._id}
                                type="button"
                                onClick={() => addTag(tag.name)}
                                className="w-full px-3 py-2 text-left text-sm text-fg hover:bg-accent-subtle flex items-center gap-2"
                            >
                                <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: tag.color ?? '#6b7280' }}
                                />
                                {tag.name}
                            </button>
                        ))}
                        {canCreate && (
                            <button
                                type="button"
                                onClick={createTag}
                                disabled={creating}
                                className="w-full px-3 py-2 text-left text-sm text-accent hover:bg-accent-subtle border-t border-border-subtle disabled:opacity-50"
                            >
                                {creating ? 'Creating...' : `Create "${trimmedInput}"`}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default TagPicker
