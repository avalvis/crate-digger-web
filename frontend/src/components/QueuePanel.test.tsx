import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { QueueJob, QueuePage } from '../lib/types'
import { QueuePanel } from './QueuePanel'

function job(values: Partial<QueueJob> = {}): QueueJob {
  return {
    id: 7,
    source_url: 'https://music.youtube.com/watch?v=rare',
    display_name: 'Rare Artist — Dusty Loop',
    status: 'separating_stems',
    operation: 'ingest',
    origin: 'digital_crate',
    progress_pct: 82,
    stage_percent: 64,
    current_stage: 'separating_stems',
    status_message: 'Separating drums and bass',
    error_message: null,
    failure_stage: null,
    track_id: null,
    enable_stems: true,
    retry_of_job_id: null,
    archived_at: null,
    queue_position: null,
    created_at: '2026-07-17T20:00:00Z',
    started_at: '2026-07-17T20:01:00Z',
    completed_at: null,
    ...values,
  }
}

function renderPanel(queue: QueuePage) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><QueuePanel open onOpenChange={vi.fn()} queue={queue} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('QueuePanel', () => {
  it('shows durable stage feedback and live queue counts', () => {
    renderPanel({
      items: [job()], total: 1, limit: 100, offset: 0,
      summary: { running: 1, waiting: 2, completed: 0, attention: 0, current_job_id: 7 },
    })
    expect(screen.getByText('Rare Artist — Dusty Loop')).toBeInTheDocument()
    expect(screen.getByText('Separating drums and bass')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('2', { selector: '.queue-summary strong' })).toBeInTheDocument()
  })

  it('archives completed jobs without deleting Vault audio', async () => {
    const archive = vi.spyOn(api, 'archiveCompletedJobs').mockResolvedValue({ affected: 1 })
    renderPanel({
      items: [job({ status: 'complete', progress_pct: 100, current_stage: 'complete', status_message: 'Track ready in the Vault', completed_at: '2026-07-17T20:04:00Z' })],
      total: 1, limit: 100, offset: 0,
      summary: { running: 0, waiting: 0, completed: 1, attention: 0, current_job_id: null },
    })
    fireEvent.click(screen.getByRole('button', { name: /clear completed/i }))
    await waitFor(() => expect(archive).toHaveBeenCalledOnce())
  })
})
