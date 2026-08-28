import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useUser } from '../../hooks/useUser'
import type { ApiResponse, User } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'

const ProfileSettings: React.FC = () => {
    const { user, updateUser } = useUser()
    const [fullName, setFullName] = useState(user?.fullName ?? '')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        setFullName(user?.fullName ?? '')
    }, [user?.fullName])

    if (!user) return null

    const dirty = fullName.trim() !== user.fullName

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()

        if (!fullName.trim()) {
            toast.error('Full name is required')
            return
        }

        setSubmitting(true)
        try {
            const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                fullName: fullName.trim(),
            })
            updateUser(unwrapApiData(response))
            toast.success('Profile updated')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to update profile'))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div>
            <p className="section-label mb-3">Profile</p>
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
                <label className="block text-sm text-text-secondary">
                    Full name
                    <input
                        type="text"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Your name"
                        required
                        disabled={submitting}
                        className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                    />
                </label>
                {/*
                  V5: timezone is auto-detected from the device (at signup and once per session) -
                  there is no picker any more. Showing the current value turns what would otherwise
                  look like a silent overwrite into explained behaviour.
                */}
                <div className="block text-sm text-text-secondary">
                    Timezone
                    <p className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary">
                        {user.timezone ?? 'UTC'}
                    </p>
                    <p className="mt-1.5 text-xs text-text-quiet">
                        Detected automatically from your device. Corvale updates this when your device&rsquo;s
                        timezone changes, so your dates and reminders stay correct.
                    </p>
                </div>
                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={submitting || !dirty}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg btn-accent transition-colors disabled:opacity-60"
                    >
                        {submitting ? 'Saving...' : 'Save profile'}
                    </button>
                </div>
            </form>
        </div>
    )
}

export default ProfileSettings
