import { useState } from 'react'

import { ActionDialog } from '../components/ActionDialog'
import { useStepUp } from '../components/StepUp'
import { Badge, Button, ErrorAlert, Field, Section, Spinner, inputClass } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, humanize } from '../lib/format'
import type { GrandfatherCohortPreview } from '../lib/types'
import { useAsync } from '../lib/useAsync'

const KINDS = ['free_forever', 'locked_rate', 'extended_trial']

const SuccessBanner = ({ message }: { message: string | null }) =>
  message ? (
    <p role="status" className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-sm">
      {message}
    </p>
  ) : null

/**
 * The bulk half of M7.4: preview a cohort (registered before a cutoff, no provider link, not already
 * grandfathered), then apply it only after the admin types back the exact count the preview showed, and
 * revert by batch id later. Apply and revert are step-up gated; the preview is not, mirroring the API.
 */
const GrandfatherCohortPage = () => {
  const { run } = useStepUp()
  const batches = useAsync(() => api.listGrandfatherBatches(), [])

  const [kind, setKind] = useState(KINDS[0])
  const [registeredBefore, setRegisteredBefore] = useState('')
  const [preview, setPreview] = useState<GrandfatherCohortPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [confirmCount, setConfirmCount] = useState('')
  const [revertTarget, setRevertTarget] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const resetCriteria = () => {
    setPreview(null)
    setResult(null)
  }

  const previewCohort = async () => {
    if (!registeredBefore || previewing) return

    setPreviewing(true)
    setPreviewError(null)
    setPreview(null)
    try {
      setPreview(await api.previewGrandfatherCohort({ kind, registeredBefore: new Date(registeredBefore).toISOString() }))
    } catch (failure) {
      setPreviewError(failure instanceof Error ? failure.message : 'The preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const applyCohort = async (reason: string) => {
    if (!preview) return
    const typed = Number(confirmCount)
    if (!Number.isInteger(typed) || typed !== preview.count) throw new Error(`Type ${preview.count} to confirm`)

    const outcome = await run(() =>
      api.applyGrandfatherCohort({ kind: preview.kind, registeredBefore: preview.registeredBefore, confirmCount: typed, reason })
    )

    setResult(`Applied ${humanize(preview.kind)} to ${outcome.appliedCount} ${outcome.appliedCount === 1 ? 'subscriber' : 'subscribers'} (batch ${outcome.batchId}).`)
    setApplyOpen(false)
    setConfirmCount('')
    setPreview(null)
    setRegisteredBefore('')
    batches.reload()
  }

  const revertBatch = async (reason: string) => {
    if (!revertTarget) return
    const outcome = await run(() => api.revertGrandfatherCohort(revertTarget, { reason }))

    setResult(`Reverted ${outcome.revertedCount} ${outcome.revertedCount === 1 ? 'subscriber' : 'subscribers'}.`)
    setRevertTarget(null)
    batches.reload()
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Grandfather cohort</h1>

      <Section title="Preview a cohort">
        <p className="mb-3 text-sm text-text-muted">Everyone who registered before the date below, has no payment-provider link, and is not already grandfathered.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Kind" htmlFor="cohort-kind">
            <select
              id="cohort-kind"
              className={inputClass}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value)
                resetCriteria()
              }}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Registered before" htmlFor="cohort-cutoff">
            <input
              id="cohort-cutoff"
              type="date"
              className={inputClass}
              value={registeredBefore}
              onChange={(event) => {
                setRegisteredBefore(event.target.value)
                resetCriteria()
              }}
            />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" onClick={() => void previewCohort()} disabled={!registeredBefore || previewing}>
              {previewing ? 'Checking...' : 'Preview'}
            </Button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <ErrorAlert message={previewError} />
          <SuccessBanner message={result} />

          {preview ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <p>
                <strong>{preview.count}</strong> {preview.count === 1 ? 'subscriber matches' : 'subscribers match'} this cohort for{' '}
                <Badge>{humanize(preview.kind)}</Badge>.
              </p>
              {preview.sample.length > 0 ? <p className="mt-1 text-text-muted">Sample: {preview.sample.join(', ')}</p> : null}
              {preview.count > 0 ? (
                <Button className="mt-3" variant="primary" onClick={() => setApplyOpen(true)}>
                  Apply to this cohort
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Batches">
        <ErrorAlert message={batches.error} />
        {batches.loading && !batches.data ? <Spinner /> : null}
        {batches.data ? (
          batches.data.batches.length === 0 ? (
            <p className="text-sm text-text-muted">No bulk grandfather batches yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="py-1 pr-4 font-medium">Batch</th>
                  <th className="py-1 pr-4 font-medium">Kind</th>
                  <th className="py-1 pr-4 font-medium">Registered before</th>
                  <th className="py-1 pr-4 font-medium">Count</th>
                  <th className="py-1 pr-4 font-medium">Status</th>
                  <th className="py-1 pr-4 font-medium">Created</th>
                  <th className="py-1 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batches.data.batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="py-2 pr-4 font-mono text-xs">{batch.id}</td>
                    <td className="py-2 pr-4">{humanize(batch.kind)}</td>
                    <td className="py-2 pr-4">{formatDateTime(batch.registeredBefore)}</td>
                    <td className="py-2 pr-4">{batch.count}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={batch.status === 'applied' ? 'good' : 'neutral'}>{humanize(batch.status)}</Badge>
                    </td>
                    <td className="py-2 pr-4">{formatDateTime(batch.createdAt)}</td>
                    <td className="py-2">{batch.status === 'applied' ? <Button onClick={() => setRevertTarget(batch.id)}>Revert</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </Section>

      {applyOpen && preview ? (
        <ActionDialog
          title="Apply the grandfather cohort"
          submitLabel="Apply"
          variant="danger"
          description={`This changes ${preview.count} ${preview.count === 1 ? 'subscriber' : 'subscribers'} at once. Type ${preview.count} to confirm.`}
          canSubmit={confirmCount.trim() !== '' && Number(confirmCount) === preview.count}
          onCancel={() => setApplyOpen(false)}
          onSubmit={applyCohort}
        >
          <Field label={`Type ${preview.count} to confirm`} htmlFor="cohort-confirm">
            <input id="cohort-confirm" className={inputClass} inputMode="numeric" value={confirmCount} onChange={(event) => setConfirmCount(event.target.value)} />
          </Field>
        </ActionDialog>
      ) : null}

      {revertTarget ? (
        <ActionDialog
          title="Revert this batch"
          submitLabel="Revert"
          variant="danger"
          description="Only reverts rows still at the batch's kind - anything an admin changed by hand since is left alone."
          onCancel={() => setRevertTarget(null)}
          onSubmit={revertBatch}
        />
      ) : null}
    </>
  )
}

export default GrandfatherCohortPage
