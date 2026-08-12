import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
    IoAdd,
    IoChevronDown,
    IoChevronUp,
    IoPencil,
    IoStar,
    IoStarOutline,
    IoTrash,
} from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FormField from '../../components/forms/FormField'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ApiResponse, CategoriesResponse, Category, CategoryEditFormData, CategoryFormData } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import {
    CATEGORY_ICON_OPTIONS,
    CategoryIcon,
    DEFAULT_CATEGORY_COLORS,
} from '../../utils/categoryIcons'
import {
    flattenCategoryOrder,
    groupCategoriesByMaster,
    type CategoryGroup,
} from '../../components/categories/CategoryPicker'

interface SelectFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string; label: string }[]
    required?: boolean
    disabled?: boolean
}

const SelectField: React.FC<SelectFieldProps> = ({
    label,
    value,
    onChange,
    options,
    required,
    disabled,
}) => (
    <div>
        <label className="text-[13px] text-slate-300">
            {label}
            {required && <span className="text-rose-400 ml-0.5">*</span>}
        </label>
        <div className="input-box mb-0 mt-1">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={required}
                disabled={disabled}
                className="w-full bg-transparent outline-none text-slate-200"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value} className="bg-slate-900">
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    </div>
)

const emptyCreateForm = (masterCategoryId = ''): CategoryFormData => ({
    masterCategoryId,
    name: '',
    icon: 'tag',
    color: DEFAULT_CATEGORY_COLORS[0],
})

const emptyEditForm = (): CategoryEditFormData => ({
    name: '',
    icon: 'tag',
    color: DEFAULT_CATEGORY_COLORS[0],
})

const reorderWithinGroups = (
    groups: CategoryGroup[],
    categoryId: string,
    direction: 'up' | 'down'
): CategoryGroup[] | null => {
    const nextGroups = groups.map((group) => ({ ...group, subs: [...group.subs] }))

    for (const group of nextGroups) {
        const index = group.subs.findIndex((sub) => sub._id === categoryId)
        if (index === -1) continue

        const targetIndex = direction === 'up' ? index - 1 : index + 1
        if (targetIndex < 0 || targetIndex >= group.subs.length) {
            return null
        }

        const [moved] = group.subs.splice(index, 1)
        group.subs.splice(targetIndex, 0, moved)
        return nextGroups
    }

    return null
}

const Categories = () => {
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [createForm, setCreateForm] = useState<CategoryFormData>(emptyCreateForm())
    const [editForm, setEditForm] = useState<CategoryEditFormData>(emptyEditForm())
    const [editingCategory, setEditingCategory] = useState<Category | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [archiveTarget, setArchiveTarget] = useState<Category | null>(null)
    const [archiving, setArchiving] = useState(false)
    const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)
    const [reorderingId, setReorderingId] = useState<string | null>(null)

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

    const { data: categories, loading, error, refetch } = useAsyncData(fetchCategories, [fetchCategories])

    const grouped = useMemo(() => {
        if (!categories) return []
        return groupCategoriesByMaster(categories.masters, categories.userCategories)
    }, [categories])

    const openCreate = (masterCategoryId?: string) => {
        setCreateForm(emptyCreateForm(masterCategoryId ?? categories?.masters[0]?._id ?? ''))
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setCreateForm(emptyCreateForm())
    }

    const openEdit = (category: Category) => {
        setEditingCategory(category)
        setEditForm({
            name: category.name,
            icon: category.icon ?? 'tag',
            color: category.color ?? DEFAULT_CATEGORY_COLORS[0],
        })
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingCategory(null)
        setEditForm(emptyEditForm())
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!createForm.masterCategoryId) {
            toast.error('Master category is required')
            return
        }

        if (!createForm.name.trim()) {
            toast.error('Category name is required')
            return
        }

        setSubmitting(true)
        try {
            await axiosInstance.post(API_PATHS.CATEGORIES.CREATE, {
                masterCategoryId: createForm.masterCategoryId,
                name: createForm.name.trim(),
                icon: createForm.icon,
                color: createForm.color,
            })
            toast.success('Category created')
            closeCreate()
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create category'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingCategory) return

        if (!editForm.name.trim()) {
            toast.error('Category name is required')
            return
        }

        setSubmitting(true)
        try {
            await axiosInstance.put(API_PATHS.CATEGORIES.UPDATE(editingCategory._id), {
                name: editForm.name.trim(),
                icon: editForm.icon,
                color: editForm.color,
            })
            toast.success('Category updated')
            closeEdit()
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update category'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleSetDefault = async (category: Category) => {
        if (category.isDefault) return

        setSettingDefaultId(category._id)
        try {
            await axiosInstance.put(API_PATHS.CATEGORIES.UPDATE(category._id), { isDefault: true })
            toast.success(`"${category.name}" is now your default category`)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to set default category'))
        } finally {
            setSettingDefaultId(null)
        }
    }

    const handleArchive = async () => {
        if (!archiveTarget) return

        setArchiving(true)
        try {
            await axiosInstance.delete(API_PATHS.CATEGORIES.DELETE(archiveTarget._id))
            toast.success('Category archived')
            setArchiveTarget(null)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to archive category'))
        } finally {
            setArchiving(false)
        }
    }

    const handleReorder = async (categoryId: string, direction: 'up' | 'down') => {
        if (!categories) return

        const currentGroups = groupCategoriesByMaster(categories.masters, categories.userCategories)
        const nextGroups = reorderWithinGroups(currentGroups, categoryId, direction)
        if (!nextGroups) return

        const orderedIds = flattenCategoryOrder(nextGroups)
        if (orderedIds.length === 0) return

        setReorderingId(categoryId)
        try {
            await axiosInstance.put(API_PATHS.CATEGORIES.REORDER, { orderedIds })
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to reorder categories'))
        } finally {
            setReorderingId(null)
        }
    }

    const masterOptions =
        categories?.masters.map((master) => ({ value: master._id, label: master.name })) ?? []

    const renderIconPicker = (
        value: string,
        onChange: (icon: string) => void,
        disabled: boolean
    ) => (
        <div>
            <label className="text-[13px] text-slate-300">Icon</label>
            <div className="mt-2 grid grid-cols-7 gap-2">
                {CATEGORY_ICON_OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(option.value)}
                        className={[
                            'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                            value === option.value
                                ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300'
                                : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200',
                            disabled ? 'opacity-50 cursor-not-allowed' : '',
                        ].join(' ')}
                        aria-label={option.label}
                        title={option.label}
                    >
                        <option.Icon size={16} />
                    </button>
                ))}
            </div>
        </div>
    )

    const renderColorPicker = (
        value: string,
        onChange: (color: string) => void,
        disabled: boolean
    ) => (
        <div>
            <label className="text-[13px] text-slate-300">Color</label>
            <div className="mt-2 flex flex-wrap gap-2">
                {DEFAULT_CATEGORY_COLORS.map((color) => (
                    <button
                        key={color}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(color)}
                        className={[
                            'h-8 w-8 rounded-full border-2 transition-transform',
                            value === color ? 'border-white scale-110' : 'border-transparent',
                            disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105',
                        ].join(' ')}
                        style={{ backgroundColor: color }}
                        aria-label={`Color ${color}`}
                    />
                ))}
            </div>
            <div className="input-box mb-0 mt-3">
                <input
                    type="color"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    className="h-8 w-full cursor-pointer bg-transparent"
                />
            </div>
        </div>
    )

    return (
        <div>
            <PageHeader
                title="Categories"
                description="Organize spending with master categories and custom sub-categories"
                actions={
                    <button
                        type="button"
                        onClick={() => openCreate()}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors"
                    >
                        <IoAdd size={18} />
                        Add category
                    </button>
                }
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={categories}
                isEmpty={() => false}
                loadingMessage="Loading categories..."
                emptyTitle="No categories"
                emptyDescription="Master categories will appear here once loaded."
                onRetry={refetch}
            >
                {() => (
                    <div className="space-y-6">
                        {grouped.map((group) => (
                            <section key={group.master._id} className="card">
                                <div className="flex items-center justify-between gap-4 mb-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span
                                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700"
                                            style={{
                                                backgroundColor: `${group.master.color ?? '#6B7280'}15`,
                                            }}
                                        >
                                            <CategoryIcon
                                                icon={group.master.icon}
                                                color={group.master.color}
                                                size={18}
                                            />
                                        </span>
                                        <div className="min-w-0">
                                            <h2 className="text-sm font-semibold text-slate-100">
                                                {group.master.name}
                                            </h2>
                                            <p className="text-xs text-slate-500">
                                                {group.subs.length === 0
                                                    ? 'No sub-categories yet'
                                                    : `${group.subs.length} sub-categor${group.subs.length === 1 ? 'y' : 'ies'}`}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => openCreate(group.master._id)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors shrink-0"
                                    >
                                        <IoAdd size={14} />
                                        Add
                                    </button>
                                </div>

                                {group.subs.length > 0 && (
                                    <div className="space-y-2 border-t border-slate-800 pt-4">
                                        {group.subs.map((sub, index) => (
                                            <div
                                                key={sub._id}
                                                className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2.5"
                                            >
                                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                                    <span
                                                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700"
                                                        style={{
                                                            backgroundColor: `${sub.color ?? group.master.color ?? '#6B7280'}15`,
                                                        }}
                                                    >
                                                        <CategoryIcon
                                                            icon={sub.icon ?? group.master.icon}
                                                            color={sub.color ?? group.master.color}
                                                            size={15}
                                                        />
                                                    </span>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <p className="text-sm font-medium text-slate-200 truncate">
                                                                {sub.name}
                                                            </p>
                                                            {sub.isDefault && (
                                                                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
                                                                    <IoStar size={11} />
                                                                    Default
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleReorder(sub._id, 'up')}
                                                        disabled={
                                                            index === 0 || reorderingId === sub._id
                                                        }
                                                        className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-30"
                                                        aria-label="Move up"
                                                    >
                                                        <IoChevronUp size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleReorder(sub._id, 'down')}
                                                        disabled={
                                                            index === group.subs.length - 1 ||
                                                            reorderingId === sub._id
                                                        }
                                                        className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-30"
                                                        aria-label="Move down"
                                                    >
                                                        <IoChevronDown size={16} />
                                                    </button>
                                                    {!sub.isDefault && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSetDefault(sub)}
                                                            disabled={settingDefaultId === sub._id}
                                                            className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-50"
                                                            aria-label="Set as default category"
                                                            title="Set as default"
                                                        >
                                                            <IoStarOutline size={16} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(sub)}
                                                        className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                                        aria-label="Edit category"
                                                    >
                                                        <IoPencil size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setArchiveTarget(sub)}
                                                        className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                                                        aria-label="Archive category"
                                                    >
                                                        <IoTrash size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        ))}
                    </div>
                )}
            </AsyncContent>

            <Modal open={createOpen} onClose={closeCreate} title="Add category">
                <form onSubmit={handleCreate} className="space-y-4">
                    <SelectField
                        label="Master category"
                        value={createForm.masterCategoryId}
                        onChange={(v) => setCreateForm((f) => ({ ...f, masterCategoryId: v }))}
                        options={masterOptions}
                        required
                        disabled={submitting}
                    />
                    <FormField
                        label="Name"
                        value={createForm.name}
                        onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))}
                        placeholder="Groceries, Dining out, etc."
                        required
                        disabled={submitting}
                    />
                    {renderIconPicker(createForm.icon, (icon) => setCreateForm((f) => ({ ...f, icon })), submitting)}
                    {renderColorPicker(createForm.color, (color) => setCreateForm((f) => ({ ...f, color })), submitting)}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeCreate}
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Creating...' : 'Create category'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit category">
                <form onSubmit={handleEdit} className="space-y-4">
                    <FormField
                        label="Name"
                        value={editForm.name}
                        onChange={(v) => setEditForm((f) => ({ ...f, name: v }))}
                        placeholder="Category name"
                        required
                        disabled={submitting}
                    />
                    {renderIconPicker(editForm.icon, (icon) => setEditForm((f) => ({ ...f, icon })), submitting)}
                    {renderColorPicker(editForm.color, (color) => setEditForm((f) => ({ ...f, color })), submitting)}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeEdit}
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={archiveTarget !== null}
                onClose={() => setArchiveTarget(null)}
                onConfirm={handleArchive}
                title="Archive category"
                message={`Are you sure you want to archive "${archiveTarget?.name}"? It will be hidden from your category list.`}
                confirmLabel="Archive"
                loading={archiving}
            />
        </div>
    )
}

export default Categories
