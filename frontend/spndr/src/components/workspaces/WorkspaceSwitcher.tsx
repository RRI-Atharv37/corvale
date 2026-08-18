import React, { useEffect, useRef, useState } from 'react'
import { FiChevronDown, FiUsers } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../../hooks/useWorkspace'

const WorkspaceSwitcher: React.FC = () => {
    const {
        activeWorkspaceId,
        activeWorkspace,
        workspaces,
        loading,
        setActiveWorkspace,
        isPersonal,
    } = useWorkspace()
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const label = isPersonal ? 'Personal' : (activeWorkspace?.name ?? 'Workspace')

    const handleSelect = (workspaceId: string | null) => {
        setActiveWorkspace(workspaceId)
        setOpen(false)
    }

    return (
        <div ref={containerRef} className="relative px-3 pb-3">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-bg-secondary/60 px-3 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-accent-subtle/40"
                aria-expanded={open}
                aria-haspopup="listbox"
            >
                <FiUsers size={16} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wide text-text-quiet">Workspace</p>
                    <p className="truncate text-sm font-medium text-text-primary">{label}</p>
                </div>
                <FiChevronDown
                    size={16}
                    className={[
                        'shrink-0 text-text-muted transition-transform',
                        open ? 'rotate-180' : '',
                    ].join(' ')}
                />
            </button>

            {open && (
                <div
                    className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border-subtle bg-elevated shadow-lg"
                    role="listbox"
                >
                    <button
                        type="button"
                        role="option"
                        aria-selected={isPersonal}
                        onClick={() => handleSelect(null)}
                        className={[
                            'flex w-full items-center px-3 py-2.5 text-sm transition-colors',
                            isPersonal
                                ? 'bg-accent-subtle text-accent'
                                : 'text-text-secondary hover:bg-elevated-hover',
                        ].join(' ')}
                    >
                        Personal
                    </button>

                    {loading && workspaces.length === 0 && (
                        <p className="px-3 py-2 text-xs text-text-quiet">Loading workspaces...</p>
                    )}

                    {workspaces.map((workspace) => (
                        <button
                            key={workspace._id}
                            type="button"
                            role="option"
                            aria-selected={activeWorkspaceId === workspace._id}
                            onClick={() => handleSelect(workspace._id)}
                            className={[
                                'flex w-full items-center px-3 py-2.5 text-sm transition-colors',
                                activeWorkspaceId === workspace._id
                                    ? 'bg-accent-subtle text-accent'
                                    : 'text-text-secondary hover:bg-elevated-hover',
                            ].join(' ')}
                        >
                            <span className="truncate">{workspace.name}</span>
                        </button>
                    ))}

                    <div className="border-t border-border-subtle">
                        <Link
                            to="/workspaces"
                            onClick={() => setOpen(false)}
                            className="block px-3 py-2.5 text-sm text-text-muted hover:bg-elevated-hover hover:text-accent transition-colors"
                        >
                            Manage workspaces
                        </Link>
                    </div>
                </div>
            )}
        </div>
    )
}

export default WorkspaceSwitcher
