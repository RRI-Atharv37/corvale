import { useState } from 'react'

import { Badge, ErrorAlert, Facts, Section, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, formatPercent, formatMinor, formatSignedMinor, humanize } from '../lib/format'
import type { GrandfatherOutcome, LtvStatus, MetricSeriesPoint, MetricStockSegment } from '../lib/types'
import { useAsync } from '../lib/useAsync'

const WINDOW_OPTIONS = [7, 30, 90, 180, 365]

const LTV_STATUS_TONE: Record<LtvStatus, 'good' | 'warn' | 'neutral'> = { ok: 'good', capped: 'warn', insufficient_data: 'neutral' }

const OUTCOME_LABEL: Record<GrandfatherOutcome, string> = {
  free_forever: 'Free forever',
  active_grant: 'Active grant (locked rate / extended trial)',
  converted: 'Converted to a real paying subscription',
  lapsed: 'Lapsed, not converted',
}

const OUTCOME_TONE: Record<GrandfatherOutcome, 'good' | 'warn' | 'neutral' | 'bad'> = {
  free_forever: 'neutral',
  active_grant: 'warn',
  converted: 'good',
  lapsed: 'bad',
}

/** A minimal dependency-free trend line - the exact series is also in the table beside it, so nothing is chart-only. */
const Sparkline = ({ series }: { series: MetricSeriesPoint[] }) => {
  if (series.length < 2) return <p className="text-sm text-text-muted">Not enough stock snapshots yet to draw a trend.</p>

  const width = 600
  const height = 80
  const values = series.map((point) => point.mrrMinor)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = width / (series.length - 1)
  const points = values.map((value, index) => `${index * stepX},${height - ((value - min) / span) * height}`).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`MRR from ${formatMinor(values[0])} to ${formatMinor(values[values.length - 1])}`} className="h-20 w-full">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} className="text-accent" />
    </svg>
  )
}

/** Signed horizontal bars, scaled to the largest magnitude in the set, so growth/contraction/churn read at a glance. */
const MovementBars = ({ rows }: { rows: { label: string; minor: number; tone: 'good' | 'bad' | 'neutral' }[] }) => {
  const scale = Math.max(1, ...rows.map((row) => Math.abs(row.minor)))
  const barColor = { good: 'bg-good', bad: 'bg-danger', neutral: 'bg-text-muted' } as const

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-2 text-sm">
          <span className="text-text-muted">{row.label}</span>
          <span className="h-2 rounded-full bg-surface-2">
            <span className={`block h-2 rounded-full ${barColor[row.tone]}`} style={{ width: `${(Math.abs(row.minor) / scale) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-xs">{formatSignedMinor(row.minor)}</span>
        </li>
      ))}
    </ul>
  )
}

const segmentKey = (segment: MetricStockSegment): string => `${segment.planCode}-${segment.status}-${segment.interval ?? 'none'}-${segment.grandfatherKind ?? 'none'}`

const MetricsPage = () => {
  const [days, setDays] = useState(30)
  const overview = useAsync(() => api.metricsOverview(days), [days])
  const cohort = useAsync(() => api.grandfatherCohortReport(), [])
  const data = overview.data

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Metrics</h1>
        <label className="flex items-center gap-2 text-sm text-text-muted">
          Window
          <select className="rounded-md border border-border bg-page px-2 py-1 text-text" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {WINDOW_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} days
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorAlert message={overview.error} />
      {overview.loading && !data ? <Spinner /> : null}

      {data ? (
        <>
          <p className="text-xs text-text-muted">
            All dates and figures below are UTC calendar days. Generated {formatDateTime(data.generatedAt)}. {data.dataQuality.daysWithStock} of {data.dataQuality.daysRequested} requested
            days have a stock snapshot{data.dataQuality.daysWithStock < data.dataQuality.daysRequested ? ' - thin coverage, treat figures as provisional' : ''}.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="MRR (list price)">
              {data.stock ? (
                <>
                  <Facts
                    rows={[
                      ['MRR', formatMinor(data.stock.listPriceMrrMinor)],
                      ['At-risk MRR (past_due)', formatMinor(data.stock.atRiskMrrMinor)],
                      ['Paying subscribers', String(data.stock.payingSubscribers)],
                      ['ARPA', formatMinor(data.stock.arpaMinor)],
                      ['As of', formatDateTime(data.stock.asOf)],
                    ]}
                  />
                  <div className="mt-3">
                    <Sparkline series={data.series} />
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-muted">No stock snapshot has landed in this window yet. Run `sweep:billing` to produce one.</p>
              )}
            </Section>

            <Section title="MRR movement, reconciled">
              {data.movement ? (
                <>
                  <MovementBars
                    rows={[
                      { label: 'New', minor: data.movement.newMrrMinor, tone: 'good' },
                      { label: 'Expansion', minor: data.movement.expansionMrrMinor, tone: 'good' },
                      { label: 'Contraction', minor: -data.movement.contractionMrrMinor, tone: 'bad' },
                      { label: 'Churned', minor: -data.movement.churnedMrrMinor, tone: 'bad' },
                    ]}
                  />
                  <div className="mt-3 border-t border-border pt-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Expected delta (flows)</span>
                      <span className="font-mono">{formatSignedMinor(data.movement.expectedDeltaMinor)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Actual delta (stock)</span>
                      <span className="font-mono">{formatSignedMinor(data.movement.actualDeltaMinor)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Unexplained / late events</span>
                      <span className="font-mono">
                        {formatSignedMinor(data.movement.residualMinor)}{' '}
                        {data.movement.residualMinor !== 0 ? <Badge tone="warn">residual</Badge> : <Badge tone="good">reconciles</Badge>}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-muted">Needs two stock snapshots in the window to compute a delta - widen the window or wait for another sweep run.</p>
              )}
            </Section>

            <Section title="Rates">
              <Facts
                rows={[
                  ['Logo churn', formatPercent(data.rates.logoChurn)],
                  ['Revenue churn', formatPercent(data.rates.revenueChurn)],
                  ['Trial to paid conversion', formatPercent(data.rates.trialConversionRate)],
                  ['Dunning recovery', formatPercent(data.rates.dunningRecoveryRate)],
                ]}
              />
              <p className="mt-2 text-xs text-text-muted">Trial conversion is flow-based: converted / (converted + expired) in this window, not a cohort-exact rate.</p>
            </Section>

            <Section title="Estimated LTV (steady-state)" action={<Badge tone={LTV_STATUS_TONE[data.ltv.status]}>{humanize(data.ltv.status)}</Badge>}>
              {data.ltv.status === 'insufficient_data' ? (
                <p className="text-sm text-text-muted">
                  Not enough evidence yet ({data.ltv.churnEvents} churn events, {data.ltv.subscribersAtRisk} subscribers at risk). Needs at least 90 days of data and 30 churn events.
                </p>
              ) : (
                <>
                  <Facts
                    rows={[
                      ['Estimate', formatMinor(data.ltv.ltvMinor)],
                      ['Low - high band', `${formatMinor(data.ltv.lowMinor)} - ${formatMinor(data.ltv.highMinor)}`],
                      ['Churn rate used', formatPercent(data.ltv.churnRate, 2)],
                      ['Evidence', `${data.ltv.churnEvents} churn events, ${data.ltv.subscribersAtRisk} subscribers at risk`],
                    ]}
                  />
                  {data.ltv.status === 'capped' ? <p className="mt-2 text-xs text-text-muted">Churn is too low to measure a real lifetime - shown at the 36-month cap, not extrapolated toward infinity.</p> : null}
                </>
              )}
            </Section>
          </div>

          {data.stock && data.stock.segments.length > 0 ? (
            <Section title="Subscriber stock, by plan / status / interval / grandfather">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Plan</th>
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 font-medium">Interval</th>
                    <th className="py-1 pr-4 font-medium">Grandfather</th>
                    <th className="py-1 pr-4 font-medium text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.stock.segments.map((segment) => (
                    <tr key={segmentKey(segment)}>
                      <td className="py-1.5 pr-4">{segment.planCode}</td>
                      <td className="py-1.5 pr-4">{humanize(segment.status)}</td>
                      <td className="py-1.5 pr-4">{segment.interval ? humanize(segment.interval) : '-'}</td>
                      <td className="py-1.5 pr-4">{segment.grandfatherKind ? humanize(segment.grandfatherKind) : '-'}</td>
                      <td className="py-1.5 pr-4 text-right">{segment.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ) : null}
        </>
      ) : null}

      <Section title="Grandfather cohort report">
        <ErrorAlert message={cohort.error} />
        {cohort.loading && !cohort.data ? <Spinner /> : null}
        {cohort.data ? (
          <>
            <p className="mb-3 text-sm text-text-muted">
              Everyone a single grandfather grant or a bulk cohort batch ever touched ({cohort.data.totalEverGrandfathered} total), by current outcome. "Value foregone" is the still-grandfathered
              buckets' monthly list-price MRR - what they would be paying without the grant, not a historical total.
            </p>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="py-1 pr-4 font-medium">Outcome</th>
                  <th className="py-1 pr-4 font-medium text-right">Count</th>
                  <th className="py-1 font-medium text-right">Value foregone / month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cohort.data.buckets.map((bucket) => (
                  <tr key={bucket.outcome}>
                    <td className="py-1.5 pr-4">
                      <Badge tone={OUTCOME_TONE[bucket.outcome]}>{OUTCOME_LABEL[bucket.outcome]}</Badge>
                    </td>
                    <td className="py-1.5 pr-4 text-right">{bucket.count}</td>
                    <td className="py-1.5 text-right font-mono">{bucket.foregoneMrrMinor > 0 ? formatMinor(bucket.foregoneMrrMinor) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </Section>

      <Section title="Definitions and known limits">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-muted">
          <li>Every bucket is a UTC calendar day; months are UTC months. Nothing here uses local-timezone bucketing.</li>
          <li>MRR is list price: discounts, regional pricing and tax are not in it. Comps, overrides and free_forever are excluded.</li>
          <li>ARPA and LTV inputs use list price, not net of the payment provider's fee - that fee is unknown until a Merchant of Record is chosen.</li>
          <li>Collected cash revenue (a monthly rollup of actual payments net of refunds) is not instrumented yet - only MRR-basis flow counters and stock exist today.</li>
          <li>A closed day's stock is never rewritten. A missed day shows a coverage gap above rather than being backfilled with today's numbers.</li>
          <li>Flow counters are additive and revisable: a late-arriving webhook still lands on its own event day, which can move an already-closed day's totals.</li>
          <li>Estimated LTV is a model output, never a realised figure - see the panel above for its evidence thresholds and the 36-month cap.</li>
        </ul>
      </Section>
    </>
  )
}

export default MetricsPage
