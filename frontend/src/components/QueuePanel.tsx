import { Dialog } from 'radix-ui'
import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { QueueJob } from '../lib/types'

function statusIcon(job: QueueJob) {
  if (job.status === 'complete') return <Check size={15} />
  if (job.status === 'failed') return <CircleAlert size={15} />
  return <LoaderCircle size={15} className={job.status !== 'cancelled' ? 'spin' : ''} />
}

export function QueuePanel({ open, onOpenChange, jobs }: { open: boolean; onOpenChange: (open: boolean) => void; jobs: QueueJob[] }) {
  const queryClient = useQueryClient()
  const cancel = useMutation({
    mutationFn: api.cancelJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  })
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="queue-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">BACKGROUND ENGINE</span><Dialog.Title>Ingestion Queue</Dialog.Title></div>
            <Dialog.Close className="icon-button"><X size={18} /></Dialog.Close>
          </div>
          <Dialog.Description className="muted">Downloads and analysis keep running while you move around the app.</Dialog.Description>
          <div className="queue-list">
            {jobs.length === 0 && <div className="empty-compact">Your queue is empty.</div>}
            {jobs.map((job) => {
              const active = !['complete', 'failed', 'cancelled'].includes(job.status)
              return (
                <article className="queue-job" key={job.id}>
                  <div className={`queue-job__icon queue-job__icon--${job.status}`}>{statusIcon(job)}</div>
                  <div className="queue-job__main">
                    <strong>{job.display_name || new URL(job.source_url).hostname}</strong>
                    <span>{job.current_stage || job.status.replaceAll('_', ' ')}</span>
                    <div className="progress"><i style={{ width: `${job.progress_pct}%` }} /></div>
                    {job.error_message && <small className="error-text">{job.error_message}</small>}
                  </div>
                  {active && <button className="icon-button" onClick={() => cancel.mutate(job.id)} aria-label="Cancel job"><X size={15} /></button>}
                </article>
              )
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

