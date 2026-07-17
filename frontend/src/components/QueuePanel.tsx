import { useMemo, useState } from 'react'
import { Dialog } from 'radix-ui'
import {
  Archive, Check, CircleAlert, Clock3, FolderOpen, History, LoaderCircle,
  RefreshCw, RotateCcw, Search, Square, Trash2, X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { QueueJob, QueuePage } from '../lib/types'
import { useToastStore } from '../store/toast'

const ACTIVE = new Set(['pending', 'downloading', 'analyzing', 'tagging', 'separating_stems'])
const ATTENTION = new Set(['failed', 'complete_with_warnings'])

function statusIcon(job: QueueJob) {
  if (job.status === 'complete') return <Check size={15} />
  if (ATTENTION.has(job.status)) return <CircleAlert size={15} />
  if (job.status === 'cancelled') return <Square size={14} />
  return <LoaderCircle size={15} className="spin" />
}

function fallbackName(job: QueueJob) {
  try { return new URL(job.source_url).hostname }
  catch { return job.source_url }
}

function relativeTime(value: string | null) {
  if (!value) return 'Just now'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(value).toLocaleDateString()
}

function stageNumber(job: QueueJob) {
  const stage = job.current_stage || job.status
  if (stage === 'pending') return 0
  if (stage === 'downloading') return 1
  if (stage === 'analyzing') return 2
  if (['fetching_artwork', 'tagging', 'relocating', 'indexing'].includes(stage)) return 3
  if (stage === 'separating_stems') return 4
  if (['complete', 'complete_with_warnings'].includes(job.status)) return 5
  return Math.max(1, Math.min(4, Math.floor(job.progress_pct / 20)))
}

function StageRail({ job }: { job: QueueJob }) {
  const labels = job.enable_stems || job.operation === 'stems'
    ? ['Download', 'Analyze', 'File', 'Stems', 'Ready']
    : ['Download', 'Analyze', 'File', 'Ready']
  const current = stageNumber(job)
  return <div className="stage-rail" aria-label={`Current stage: ${job.current_stage || job.status}`}>
    {labels.map((label, index) => {
      const normalized = labels.length === 4 && index === 3 ? 5 : index + 1
      return <span key={label} className={normalized < current ? 'done' : normalized === current ? 'current' : ''}>{label}</span>
    })}
  </div>
}

type QueueAction =
  | { type: 'cancel' | 'retry' | 'archive'; id: number }
  | { type: 'cancel-all' | 'archive-completed' | 'delete-history' }

export function QueuePanel({ open, onOpenChange, queue }: { open: boolean; onOpenChange: (open: boolean) => void; queue?: QueuePage }) {
  const [tab, setTab] = useState<'queue' | 'history'>('queue')
  const [search, setSearch] = useState('')
  const [historyStatus, setHistoryStatus] = useState('')
  const [historyLimit, setHistoryLimit] = useState(100)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToastStore((state) => state.show)
  const historyQuery = useQuery({
    queryKey: ['jobs', 'history', search, historyStatus, historyLimit],
    queryFn: () => api.jobs({ view: 'history', query: search, status: historyStatus || undefined, limit: historyLimit }),
    enabled: open && tab === 'history',
  })
  const action = useMutation({
    mutationFn: async (value: QueueAction) => {
      if (value.type === 'cancel') return api.cancelJob(value.id)
      if (value.type === 'retry') return api.retryJob(value.id)
      if (value.type === 'archive') return api.archiveJob(value.id)
      if (value.type === 'cancel-all') return api.cancelAllJobs()
      if (value.type === 'archive-completed') return api.archiveCompletedJobs()
      return api.deleteJobHistory()
    },
    onSuccess: (_, value) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      const messages: Record<QueueAction['type'], string> = {
        cancel: 'Cancellation requested', retry: 'Retry added to the queue', archive: 'Job moved out of the live queue',
        'cancel-all': 'All active work is stopping', 'archive-completed': 'Completed jobs moved to History',
        'delete-history': 'Archived job history cleared',
      }
      toast(messages[value.type], 'success')
    },
    onError: (error) => toast(error.message, 'error'),
  })

  const items = useMemo(() => {
    const source = tab === 'history' ? historyQuery.data?.items || [] : queue?.items || []
    const needle = search.trim().toLowerCase()
    const filtered = tab === 'queue' && needle
      ? source.filter((job) => `${job.display_name} ${job.source_url} ${job.status_message}`.toLowerCase().includes(needle))
      : source
    return [...filtered].sort((a, b) => {
      const aRank = ACTIVE.has(a.status) ? 0 : ATTENTION.has(a.status) ? 1 : 2
      const bRank = ACTIVE.has(b.status) ? 0 : ATTENTION.has(b.status) ? 1 : 2
      return aRank - bRank || (b.created_at || '').localeCompare(a.created_at || '')
    })
  }, [historyQuery.data, queue?.items, search, tab])

  const summary = queue?.summary || { running: 0, waiting: 0, completed: 0, attention: 0, current_job_id: null }
  const openVault = () => { onOpenChange(false); navigate('/vault') }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="queue-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">BACKGROUND ENGINE</span><Dialog.Title>Ingestion Queue</Dialog.Title></div>
            <Dialog.Close className="icon-button"><X size={18} /></Dialog.Close>
          </div>
          <Dialog.Description className="queue-description">Every download, analysis pass, and stem job remains visible while you keep digging.</Dialog.Description>

          <div className="queue-summary">
            <div><strong>{summary.running}</strong><span>Running</span></div>
            <div><strong>{summary.waiting}</strong><span>Waiting</span></div>
            <div><strong>{summary.completed}</strong><span>Ready</span></div>
            <div className={summary.attention ? 'attention' : ''}><strong>{summary.attention}</strong><span>Attention</span></div>
          </div>

          <div className={`queue-toolbar ${tab === 'history' ? 'queue-toolbar--history' : ''}`}>
            <div className="queue-tabs" role="tablist">
              <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}><Clock3 size={13} /> Queue</button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={13} /> History</button>
            </div>
            <label className="queue-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a job" /></label>
            {tab === 'history' && <select className="queue-status-filter" aria-label="Filter history by status" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
              <option value="">All outcomes</option>
              <option value="complete">Ready</option>
              <option value="complete_with_warnings">Warnings</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>}
          </div>

          <div className="queue-bulk-actions">
            {tab === 'queue' && summary.running + summary.waiting > 0 && <button onClick={() => action.mutate({ type: 'cancel-all' })}><Square size={12} /> Stop all</button>}
            {tab === 'queue' && summary.completed > 0 && <button onClick={() => action.mutate({ type: 'archive-completed' })}><Archive size={12} /> Clear completed</button>}
            {tab === 'history' && items.some((job) => job.archived_at) && <button onClick={() => action.mutate({ type: 'delete-history' })}><Trash2 size={12} /> Clear archived history</button>}
          </div>

          <div className="queue-list">
            {historyQuery.isPending && tab === 'history' && <div className="empty-compact"><LoaderCircle className="spin" size={15} /> Loading history…</div>}
            {!historyQuery.isPending && items.length === 0 && <div className="empty-compact">{tab === 'history' ? 'No finished jobs match this view.' : 'Your live queue is empty.'}</div>}
            {items.map((job) => {
              const active = ACTIVE.has(job.status)
              const retryable = ['failed', 'cancelled', 'complete_with_warnings'].includes(job.status)
              return (
                <article className={`queue-job queue-job--${job.status}`} key={job.id}>
                  <div className={`queue-job__icon queue-job__icon--${job.status}`}>{statusIcon(job)}</div>
                  <div className="queue-job__main">
                    <div className="queue-job__title"><strong>{job.display_name || fallbackName(job)}</strong><time>{relativeTime(job.completed_at || job.started_at || job.created_at)}</time></div>
                    <div className="queue-job__meta">
                      <span>{job.origin.replaceAll('_', ' ')}</span>
                      <span>{job.operation === 'stems' ? 'stem retry' : job.enable_stems ? 'ingest + stems' : 'ingest'}</span>
                      {job.queue_position && <span>waiting #{job.queue_position}</span>}
                    </div>
                    <StageRail job={job} />
                    <div className="queue-job__status"><span>{job.status_message || job.current_stage || job.status.replaceAll('_', ' ')}</span><b>{Math.round(job.progress_pct)}%</b></div>
                    <div className="progress"><i style={{ width: `${job.progress_pct}%` }} /></div>
                    {job.error_message && <div className="queue-job__error"><CircleAlert size={13} /><span>{job.error_message}</span></div>}
                    <div className="queue-job__actions">
                      {active && <button onClick={() => action.mutate({ type: 'cancel', id: job.id })}><X size={12} /> Cancel</button>}
                      {retryable && <button className="primary" onClick={() => action.mutate({ type: 'retry', id: job.id })}><RotateCcw size={12} /> {job.status === 'complete_with_warnings' ? 'Retry stems' : 'Retry'}</button>}
                      {job.track_id && <button onClick={openVault}><FolderOpen size={12} /> Open in Vault</button>}
                      {!active && job.status !== 'complete' && <button onClick={() => action.mutate({ type: 'archive', id: job.id })}><Archive size={12} /> Dismiss</button>}
                    </div>
                  </div>
                </article>
              )
            })}
            {tab === 'history' && historyQuery.data && historyQuery.data.total > historyQuery.data.items.length && <button className="queue-load-more" onClick={() => setHistoryLimit((value) => value + 100)}>Load more history</button>}
          </div>
          {action.isPending && <div className="queue-action-pending"><RefreshCw className="spin" size={13} /> Updating queue…</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
