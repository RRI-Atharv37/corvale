import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Badge, Button, ErrorAlert, Field, Section, Spinner, inputClass } from '../components/ui'
import { api } from '../lib/api'
import { statusTone } from '../lib/tone'
import { formatDate, humanize } from '../lib/format'
import type { SubscriberFilters, SubscriberListItem } from '../lib/types'
import { useAsync } from '../lib/useAsync'

const PAGE_SIZE = 25

type FilterKey = Exclude<keyof SubscriberFilters, 'page' | 'limit'>

const YES_NO = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

const StatusCell = ({ item }: { item: SubscriberListItem }) => (
  <span className="flex flex-wrap items-center gap-1">
    <Badge tone={statusTone(item.resolvedStatus)}>{humanize(item.resolvedStatus)}</Badge>
    {item.status && item.status !== item.resolvedStatus ? <span className="text-xs text-text-muted">stored: {humanize(item.status)}</span> : null}
  </span>
)

const Flags = ({ item }: { item: SubscriberListItem }) => (
  <span className="flex flex-wrap gap-1">
    {item.grandfatherKind ? <Badge>{humanize(item.grandfatherKind)}</Badge> : null}
    {item.hasAdminGrant ? <Badge tone="good">admin grant</Badge> : null}
    {item.onRetentionHold ? <Badge tone="warn">erasure hold</Badge> : null}
    {item.dunningStage ? <Badge tone="warn">dunning: {humanize(item.dunningStage)}</Badge> : null}
    {item.retentionStage ? <Badge tone="warn">retention: {humanize(item.retentionStage)}</Badge> : null}
    {!item.providerLinked ? <Badge>no provider link</Badge> : null}
  </span>
)

const SubscriberTable = ({ items }: { items: SubscriberListItem[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-text-muted">
        <tr>
          <th className="py-2 pr-4 font-medium">Subscriber</th>
          <th className="py-2 pr-4 font-medium">Plan</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Writable</th>
          <th className="py-2 pr-4 font-medium">Ends</th>
          <th className="py-2 pr-4 font-medium">Flags</th>
          <th className="py-2 font-medium">Provider ref</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {items.map((item) => (
          <tr key={item.userId}>
            <td className="py-2 pr-4">
              <Link to={`/subscribers/${item.userId}`} className="font-medium text-accent underline">
                {item.email}
              </Link>
            </td>
            <td className="py-2 pr-4">{item.planCode ?? '-'}</td>
            <td className="py-2 pr-4">
              <StatusCell item={item} />
            </td>
            <td className="py-2 pr-4">{item.canWrite ? 'yes' : 'read-only'}</td>
            <td className="py-2 pr-4">{formatDate(item.trialEndsAt ?? item.currentPeriodEnd)}</td>
            <td className="py-2 pr-4">
              <Flags item={item} />
            </td>
            <td className="py-2 font-mono text-xs">{item.providerSubscriptionId ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const SubscribersPage = () => {
  const meta = useAsync(() => api.meta(), [])
  const [query, setQuery] = useState('')
  const [lookupResult, setLookupResult] = useState<SubscriberListItem[] | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({})
  const [page, setPage] = useState(1)

  const list = useAsync(() => api.listSubscribers({ page, limit: PAGE_SIZE, ...filters }), [page, JSON.stringify(filters)])

  const search = async (event: FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    if (!value || searching) return

    setSearching(true)
    setLookupError(null)
    try {
      setLookupResult((await api.lookup(value)).subscribers)
    } catch (failure) {
      setLookupResult(null)
      setLookupError(failure instanceof Error ? failure.message : 'Lookup failed')
    } finally {
      setSearching(false)
    }
  }

  const setFilter = (key: FilterKey, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value || undefined }))
    setPage(1)
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1
  const options = meta.data
  const select = (key: FilterKey, label: string, values: { value: string; label: string }[]) => (
    <Field label={label} htmlFor={`filter-${key}`}>
      <select id={`filter-${key}`} className={inputClass} value={filters[key] ?? ''} onChange={(event) => setFilter(key, event.target.value)}>
        <option value="">Any</option>
        {values.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
  const named = (values: string[]) => values.map((value) => ({ value, label: humanize(value) }))

  return (
    <>
      <h1 className="text-lg font-semibold">Subscribers</h1>

      <Section title="Find one">
        <form onSubmit={search} className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Field label="Find a subscriber" htmlFor="lookup" hint="Search is exact: a full email, user id, or provider customer or subscription id. Partial values match nothing.">
              <input
                id="lookup"
                className={inputClass}
                placeholder="Email, user id, or provider id"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={searching}>
            Find
          </Button>
        </form>
        <div className="mt-3 space-y-2">
          <ErrorAlert message={lookupError} />
          {lookupResult !== null ? (
            lookupResult.length === 0 ? (
              <p className="text-sm text-text-muted">No exact match.</p>
            ) : (
              <section aria-label="Lookup result">
                <SubscriberTable items={lookupResult} />
              </section>
            )
          ) : null}
        </div>
      </Section>

      <Section title="Browse">
        {options ? (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {select('status', 'Status', named(options.statuses))}
            {select('plan', 'Plan', named(options.plans))}
            {select('grandfatherKind', 'Grandfather', named(options.grandfatherKinds))}
            {select('dunningStage', 'Dunning', named(options.dunningStages))}
            {select('retentionStage', 'Retention', named(options.retentionStages))}
            {select('providerLinked', 'Provider link', YES_NO)}
            {select('hasAdminGrant', 'Admin grant', YES_NO)}
            {select('trialEndingWithinDays', 'Trial ends within', [
              { value: '3', label: '3 days' },
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
            ])}
          </div>
        ) : null}

        <ErrorAlert message={list.error} />
        {list.loading && !list.data ? <Spinner /> : null}
        {list.data ? (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              {list.data.total} {list.data.total === 1 ? 'subscriber' : 'subscribers'}
            </p>
            <SubscriberTable items={list.data.subscribers} />
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

export default SubscribersPage
