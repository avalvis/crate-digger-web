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
      progress_pct: 61,
      current_stage: 'analyzing',
      error_message: null,
      track_id: null,
      enable_stems: false,
      created_at: null,
      started_at: null,
      completed_at: null,
    }]} /></MemoryRouter>)
    expect(screen.getByText('Digital Crate')).toBeInTheDocument()
    expect(screen.getByText('QUEUE WORKING')).toBeInTheDocument()
    expect(screen.getByText(/61%/)).toBeInTheDocument()
  })
})

