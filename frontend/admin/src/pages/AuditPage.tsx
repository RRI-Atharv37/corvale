import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, ErrorAlert, Field, Section, Spinner, inputClass } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, humanize } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const PAGE_SIZE = 25

const AuditPage = () => {
  const meta = useAsync(() => api.meta(), [])
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const log = useAsync(() => api.audit({ page, limit: PAGE_SIZE, action }), [page, action])

  const totalPages = log.data ? Math.max(1, Math.ceil(log.data.total / log.data.limit)) : 1

  return (
    <>
      <h1 className="text-lg font-semibold">Audit log</h1>
      <Section title="Entries">
        <div className="mb-3 max-w-xs">
          <Field label="Action" htmlFor="audit-action">
            <select
              id="audit-action"
              className={inputClass}
              value={action}
              onChange={(event) => {
                setAction(event.target.value)
                setPage(1)
              }}
            >
              <option value="">Any</option>
              {(meta.data?.auditActions ?? []).map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ErrorAlert message={log.error} />
        {log.loading && !log.data ? <Spinner /> : null}
        {log.data ? (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">{log.data.total} entries, newest first. Times are UTC.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="py-1 pr-4 font-medium">When</th>
                    <th className="py-1 pr-4 font-medium">Action</th>
                    <th className="py-1 pr-4 font-medium">By</th>
                    <th className="py-1 pr-4 font-medium">Subject</th>
                    <th className="py-1 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {log.data.entries.map((entry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="py-1 pr-4 whitespace-nowrap">{formatDateTime(entry.at)}</td>
                      <td className="py-1 pr-4">{humanize(entry.action)}</td>
                      <td className="py-1 pr-4">{entry.actorType === 'system' ? 'system' : entry.adminRole ?? 'unknown'}</td>
                      <td className="py-1 pr-4">
                        {entry.subjectUserId ? (
                          <Link className="font-mono text-xs text-accent underline" to={`/subscribers/${entry.subjectUserId}`}>
                            {entry.subjectUserId}
                          </Link>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-1 text-text-muted">{entry.reason ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-sm">
              <Button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
                Previous
              </Button>
              <span className="text-text-muted">
                Page {page} of {totalPages}
              </span>
              <Button onClick={() => setPage((value) => value + 1)} disabled={page >= totalPages}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Section>
    </>
  )
}

export default AuditPage
