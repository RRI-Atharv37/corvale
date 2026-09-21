import { Link } from 'react-router-dom'

import { Badge, ErrorAlert, Facts, Section, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { formatDate, formatDateTime, humanize, relativeDays } from '../lib/format'
import type { JobStatus } from '../lib/types'
import { useAsync } from '../lib/useAsync'

const JOB_LABELS: Record<string, string> = { 'sweep:billing': 'Billing sweep (hourly)', 'reconcile:billing': 'Reconciliation (daily)' }

const Job = ({ name, job }: { name: string; job: JobStatus }) => (
  <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
    <span className="font-medium">{JOB_LABELS[name] ?? name}</span>
    {job.lastRun ? (
      <>
        <Badge tone={job.lastRun.ok ? 'good' : 'bad'}>{job.lastRun.ok ? 'ok' : `failed (${job.lastRun.exitCode ?? '?'})`}</Badge>
        <span className="text-text-muted">last run {formatDateTime(job.lastRun.startedAt)}</span>
        {Object.entries(job.lastRun.counts).length > 0 ? (
          <span className="text-xs text-text-muted">{Object.entries(job.lastRun.counts).map(([key, value]) => `${humanize(key)} ${value}`).join(', ')}</span>
        ) : null}
        {job.lastRun.error ? <span className="text-xs text-danger">{job.lastRun.error}</span> : null}
      </>
    ) : (
      <span className="text-text-muted">has never run</span>
    )}
    {job.stale ? <Badge tone="warn">stale: nothing has run recently</Badge> : null}
  </li>
)

const OverviewPage = () => {
  const health = useAsync(() => api.opsHealth(), [])
  const data = health.data

  return (
    <>
      <h1 className="text-lg font-semibold">Overview</h1>
      <ErrorAlert message={health.error} />
      {health.loading && !data ? <Spinner /> : null}

      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Switches">
            <Facts
              rows={[
                ['Billing', data.billingEnabled ? 'enabled' : 'off'],
                ['Retention (erasing lapsed accounts)', data.retentionEnabled ? 'enabled' : 'off'],
              ]}
            />
          </Section>

          <Section title="Scheduled jobs">
            <ul className="divide-y divide-border">
              {(Object.keys(data.jobs) as (keyof typeof data.jobs)[]).map((name) => (
                <Job key={name} name={name} job={data.jobs[name]} />
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-muted">Nothing schedules these yet. Run them from cron or a scheduler; this panel shows when that stops.</p>
          </Section>

          <Section title="Webhook events not applied">
            <p className="text-sm">
              <strong>{data.unprocessedEvents.count}</strong> failed and never applied.
            </p>
            {data.unprocessedEvents.recent.length > 0 ? (
              <ul className="mt-2 divide-y divide-border text-sm">
                {data.unprocessedEvents.recent.map((event, index) => (
                  <li key={`${event.type}-${event.occurredAt}-${index}`} className="py-1">
                    {event.type} <span className="text-text-muted">{formatDateTime(event.occurredAt)}</span>
                    {event.error ? <span className="block text-xs text-danger">{event.error}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <Section title="Past due, grace ending soon">
            <p className="text-sm">
              <strong>{data.pastDueNearGraceEnd.count}</strong> whose grace period closes within {data.pastDueNearGraceEnd.hours} hours.
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {data.pastDueNearGraceEnd.items.map((item) => (
                <li key={item.userId}>
                  <Link className="font-mono text-xs text-accent underline" to={`/subscribers/${item.userId}`}>
                    {item.userId}
                  </Link>{' '}
                  <span className="text-text-muted">{relativeDays(item.graceEndsAt)}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Erasures coming up">
            {data.upcomingErasures.retentionEnabled ? (
              <>
                <p className="text-sm">
                  <strong>{data.upcomingErasures.count}</strong> accounts due for erasure in the next {data.upcomingErasures.days} days.
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {data.upcomingErasures.items.map((item) => (
                    <li key={item.userId}>
                      <Link className="font-mono text-xs text-accent underline" to={`/subscribers/${item.userId}`}>
                        {item.userId}
                      </Link>{' '}
                      <span className="text-text-muted">{formatDate(item.eraseOn)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-text-muted">The retention job is off, so no account will be erased.</p>
            )}
          </Section>
        </div>
      ) : null}
    </>
  )
}

export default OverviewPage
