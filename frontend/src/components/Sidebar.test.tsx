import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('shows the active queue state and navigation', () => {
    render(<MemoryRouter><Sidebar onQueue={vi.fn()} jobs={[{
      id: 1,
      source_url: 'https://example.com/track',
      display_name: 'Rare break',
      status: 'analyzing',
      operation: 'ingest',
      origin: 'digital_crate',
      progress_pct: 61,
      stage_percent: 40,
      current_stage: 'analyzing',
      status_message: 'Analyzing BPM + key',
      error_message: null,
      failure_stage: null,
      track_id: null,
      enable_stems: false,
      retry_of_job_id: null,
      archived_at: null,
      queue_position: null,
      created_at: null,
      started_at: null,
      completed_at: null,
    }]} /></MemoryRouter>)
    expect(screen.getByText('Digital Crate')).toBeInTheDocument()
    expect(screen.getByText('Rare break')).toBeInTheDocument()
    expect(screen.getByText(/61%/)).toBeInTheDocument()
  })
})
