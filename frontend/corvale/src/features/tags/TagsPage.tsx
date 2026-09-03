import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { IoAdd, IoPencil, IoTrash, IoCloudDownloadOutline } from 'react-icons/io5'
import PageHeader from '@ui/PageHeader'
import AsyncContent from '@ui/AsyncContent'
import Modal from '@ui/Modal'
import ConfirmDialog from '@ui/ConfirmDialog'
import FormField from '@ui/forms/FormField'
import TagChip from './components/TagChip'
import type { Tag, TagFormData } from '@features/tags/types'
import { getApiErrorMessage } from '@lib/apiError'
import { DEFAULT_CATEGORY_COLORS } from '@lib/categoryIcons'
import { useOnlineStatus } from '@platform/offline/useOnlineStatus'
import OfflineNotice from '@ui/OfflineNotice'
import { useTagsData } from './hooks/useTagsData'

const emptyForm = (): TagFormData => ({
    name: '',
    color: DEFAULT_CATEGORY_COLORS[0],
})

const Tags = () => {
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [createForm, setCreateForm] = useState<TagFormData>(emptyForm())
    const [editForm, setEditForm] = useState<TagFormData>(emptyForm())
    const [editingTag, setEditingTag] = useState<Tag | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [importing, setImporting] = useState(false)

    const online = useOnlineStatus()

    const { tags, loading, error, refetch, createTag, updateTag, deleteTag, dedupeTags } = useTagsData()

    const openCreate = () => {
        setCreateForm(emptyForm())
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setCreateForm(emptyForm())
    }

    const openEdit = (tag: Tag) => {
        setEditingTag(tag)
        setEditForm({
            name: tag.name,
            color: tag.color ?? DEFAULT_CATEGORY_COLORS[0],
        })
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingTag(null)
        setEditForm(emptyForm())
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!createForm.name.trim()) {
            toast.error('Tag name is required')
            return
        }

        setSubmitting(true)
        try {
            await createTag({ name: createForm.name.trim(), color: createForm.color })
            toast.success('Tag created')
            closeCreate()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create tag'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingTag) return

        if (!editForm.name.trim()) {
            toast.error('Tag name is required')
            return
        }

        setSubmitting(true)
        try {
            await updateTag(editingTag, { name: editForm.name.trim(), color: editForm.color })
            toast.success('Tag updated')
            closeEdit()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update tag'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteTarget) return

        setDeleting(true)
        try {
            await deleteTag(deleteTarget)
            toast.success('Tag deleted')
            setDeleteTarget(null)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to delete tag'))
        } finally {
            setDeleting(false)
        }
    }

    const handleImport = async () => {
        if (!online) {
            toast.error('Importing tags from transactions requires an internet connection')
            return
        }

        setImporting(true)
        try {
            const result = await dedupeTags()
            toast.success(result.message)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to import tags from transactions'))
        } finally {
            setImporting(false)
        }
    }

    const renderColorPicker = (
        value: string,
        onChange: (color: string) => void,
        disabled: boolean
    ) => (
        <div>
            <label className="text-[13px] text-fg-secondary">Color</label>
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
                title="Tags"
                description="Organize transactions with colored labels and structured filtering"
                actions={
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handleImport}
                            disabled={importing || !online}
                            title={online ? undefined : 'Importing requires a connection'}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-accent/40 transition-colors disabled:opacity-50"
                        >
                            <IoCloudDownloadOutline size={18} />
                            {importing ? 'Importing...' : 'Import from transactions'}
                        </button>
                        <button
                            type="button"
                            onClick={openCreate}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors"
                        >
                            <IoAdd size={18} />
                            Add tag
                        </button>
                    </div>
                }
            />

            {!online && <OfflineNotice message="You are offline. Importing tags from transactions requires a connection." />}

            <AsyncContent
                loading={loading}
                error={error}
                data={tags}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading tags..."
                emptyTitle="No tags yet"
                emptyDescription="Create tags or import them from existing transaction labels."
                onRetry={refetch}
            >
                {(items) => (
                    <div className="card space-y-2">
                        {items.map((tag) => (
                            <div
                                key={tag._id}
                                className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle/80 bg-surface/40 px-3 py-2.5"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <TagChip name={tag.name} color={tag.color} size="md" />
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => openEdit(tag)}
                                        className="p-1.5 text-fg-muted hover:text-accent transition-colors"
                                        aria-label={`Edit ${tag.name}`}
                                    >
                                        <IoPencil size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDeleteTarget(tag)}
                                        className="p-1.5 text-fg-muted hover:text-expense transition-colors"
                                        aria-label={`Delete ${tag.name}`}
                                    >
                                        <IoTrash size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </AsyncContent>

            <Modal open={createOpen} onClose={closeCreate} title="Add tag">
                <form onSubmit={handleCreate} className="space-y-4">
                    <FormField
                        label="Name"
                        value={createForm.name}
                        onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))}
                        placeholder="Essential, subscription, etc."
                        required
                        disabled={submitting}
                    />
                    {renderColorPicker(createForm.color, (color) => setCreateForm((f) => ({ ...f, color })), submitting)}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeCreate}
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Creating...' : 'Create tag'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit tag">
                <form onSubmit={handleEdit} className="space-y-4">
                    <FormField
                        label="Name"
                        value={editForm.name}
                        onChange={(v) => setEditForm((f) => ({ ...f, name: v }))}
                        placeholder="Tag name"
                        required
                        disabled={submitting}
                    />
                    {renderColorPicker(editForm.color, (color) => setEditForm((f) => ({ ...f, color })), submitting)}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeEdit}
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete tag"
                message={`Delete "${deleteTarget?.name}"? Transactions that use this label will keep the text, but it will no longer appear in your tag list.`}
                confirmLabel="Delete"
                loading={deleting}
            />
        </div>
    )
}

export default Tags
