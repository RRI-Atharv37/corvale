import React, { useState } from 'react'

import { deviceLabel, formatDate, whole } from '../billingFormat'
import type { SyncDevice } from '../types'

const MAX_NAME_LENGTH = 40

interface DeviceListProps {
    devices: SyncDevice[] | null
    limit: number | null
    loading: boolean
    error: string | null
    busy: boolean
    onRevoke: (deviceId: string) => Promise<boolean>
    onRename: (deviceId: string, name: string | null) => Promise<boolean>
}

type Editing = { deviceId: string; mode: 'remove' } | { deviceId: string; mode: 'rename'; draft: string }

const DeviceRow: React.FC<{
    device: SyncDevice
    busy: boolean
    editing: Editing | null
    onEdit: (editing: Editing | null) => void
    onRevoke: DeviceListProps['onRevoke']
    onRename: DeviceListProps['onRename']
}> = ({ device, busy, editing, onEdit, onRevoke, onRename }) => {
    const label = deviceLabel(device)
    const mine = editing?.deviceId === device.deviceId ? editing : null

    const finish = async (action: Promise<boolean>) => {
        if (await action) onEdit(null)
    }

    return (
        <li className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                        {label}
                        {device.current && (
                            <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">This device</span>
                        )}
                        {!device.canPush && (
                            <span className="rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-text-secondary">Download only</span>
                        )}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                        Added {formatDate(device.firstSeenAt)} · Last synced {formatDate(device.lastSeenAt)}
                    </p>
                </div>

                {!mine && (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy}
                            aria-label={`Rename ${label}`}
                            onClick={() => onEdit({ deviceId: device.deviceId, mode: 'rename', draft: device.name ?? '' })}
                        >
                            Rename
                        </button>
                        {!device.current && (
                            <button
                                type="button"
                                className="btn-ghost"
                                disabled={busy}
                                aria-label={`Remove ${label}`}
                                onClick={() => onEdit({ deviceId: device.deviceId, mode: 'remove' })}
                            >
                                Remove
                            </button>
                        )}
                    </div>
                )}
            </div>

            {mine?.mode === 'rename' && (
                <form
                    className="mt-2 flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void finish(onRename(device.deviceId, mine.draft.trim() || null))
                    }}
                >
                    <div className="input-box mb-0 w-auto flex-1">
                        <input
                            aria-label="Device name"
                            className="w-full bg-transparent outline-none"
                            maxLength={MAX_NAME_LENGTH}
                            value={mine.draft}
                            onChange={(event) => onEdit({ ...mine, draft: event.target.value })}
                            autoFocus
                        />
                    </div>
                    <button type="submit" className="btn-primary" disabled={busy}>
                        Save
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => onEdit(null)}>
                        Cancel
                    </button>
                </form>
            )}

            {mine?.mode === 'remove' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm text-text-secondary">Remove {label} from your devices?</p>
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => void finish(onRevoke(device.deviceId))}>
                        Yes, remove
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => onEdit(null)}>
                        Keep
                    </button>
                </div>
            )}
        </li>
    )
}

const DeviceList: React.FC<DeviceListProps> = ({ devices, limit, loading, error, busy, onRevoke, onRename }) => {
    const [editing, setEditing] = useState<Editing | null>(null)

    return (
        <section aria-labelledby="sync-devices-heading" className="glass-card card rounded-xl">
            <h2 id="sync-devices-heading" className="font-display text-lg font-semibold text-text-primary">
                Sync devices
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
                {limit === null
                    ? 'Your plan uploads changes from any number of devices.'
                    : `Your plan uploads changes from ${whole(limit, 'device')}. Other devices still download everything.`}
            </p>

            {loading && <p className="mt-3 text-sm text-text-muted">Loading devices…</p>}
            {!loading && error && <p className="mt-3 text-sm text-text-muted">We could not load your devices right now.</p>}
            {!loading && !error && devices && devices.length === 0 && (
                <p className="mt-3 text-sm text-text-muted">No devices have synced yet.</p>
            )}

            {!loading && !error && devices && devices.length > 0 && (
                <>
                    <ul className="mt-2 divide-y divide-border-subtle">
                        {devices.map((device) => (
                            <DeviceRow
                                key={device.deviceId}
                                device={device}
                                busy={busy}
                                editing={editing}
                                onEdit={setEditing}
                                onRevoke={onRevoke}
                                onRename={onRename}
                            />
                        ))}
                    </ul>
                    <p className="mt-3 text-xs text-text-muted">
                        Removing a device frees its place, and nothing on it is deleted. If it syncs again it is added back at the end of the list.
                    </p>
                </>
            )}
        </section>
    )
}

export default DeviceList
