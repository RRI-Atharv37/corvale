import React from 'react'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'

const Pushover = () => {
    return (
        <div>
            <PageHeader
                title="Pushover"
                description="Monthly savings rollover — history and actions coming in Sprint 0.6"
            />

            <EmptyState
                title="No pushover history yet"
                description="When you roll over savings at month-end, snapshots will appear here. The backend endpoint for history is not yet exposed — this page is ready for Sprint 0.6 wiring."
            />
        </div>
    )
}

export default Pushover
