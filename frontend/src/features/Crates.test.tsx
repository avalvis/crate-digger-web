import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { Crates } from './Crates'

vi.mock('../lib/api', () => ({ api: {
  crateOverview: vi.fn(), crateSuggestions: vi.fn(), tracks: vi.fn(), createCrate: vi.fn(),
  updateCrate: vi.fn(), deleteCrate: vi.fn(), assignToCrate: vi.fn(), crate: vi.fn(),
  removeFromCrate: vi.fn(), track: vi.fn(), patchTrack: vi.fn(), trackWaveform: vi.fn(),
} , mediaUrl: vi.fn() }))
vi.mock('../lib/desktop', () => ({ revealFile: vi.fn() }))

function renderCrates(path = '/crates') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path="/crates" element={<Crates />} /><Route path="/crates/:crateId" element={<Crates />} /></Routes></MemoryRouter></QueryClientProvider>)
}

describe('Crates organization', () => {
  it('opens a colored crate and renders its exclusive track list', async () => {
    vi.mocked(api.crateOverview).mockResolvedValue({ items: [{ id: 3, name: 'July Dust', color: '#D47432', description: 'Summer loops', created_at: null, updated_at: null, track_count: 1 }], unassigned_count: 4 })
    vi.mocked(api.crate).mockResolvedValue({ id: 3, name: 'July Dust', color: '#D47432', description: 'Summer loops', created_at: null, updated_at: null, track_count: 1, tracks: { items: [{ id: 7, artist: 'Alice', title: 'Warm Loop', album: null, genre: 'Jazz', style: null, country: null, year: 1972, duration_seconds: 90, bpm: 84, musical_key: null, camelot_key: '8A', stems_separated: false, source_url: 'https://example.com', source_platform: 'manual', date_added: null, rating: null, notes: null, tags: [], file_available: true, artwork_url: null, output_format: 'm4a', crate: { id: 3, name: 'July Dust', color: '#D47432' } }], total: 1, limit: 250, offset: 0 } })

    renderCrates()
    expect(await screen.findByText('4 songs are waiting for a crate.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('heading', { name: 'July Dust' }))
    expect(await screen.findByText('Warm Loop')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal Alice — Warm Loop' })).toBeInTheDocument()
  })

  it('previews a genre suggestion before creating anything', async () => {
    vi.mocked(api.crateOverview).mockResolvedValue({ items: [], unassigned_count: 2 })
    vi.mocked(api.crateSuggestions).mockResolvedValue([{ key: 'genre:jazz', kind: 'genre', label: 'Jazz', proposed_name: 'Jazz', track_ids: [7], count: 1 }])
    vi.mocked(api.tracks).mockResolvedValue({ items: [{ id: 7, artist: 'Alice', title: 'Warm Loop', album: null, genre: 'Jazz', style: null, country: null, year: 1972, duration_seconds: 90, bpm: 84, musical_key: null, camelot_key: '8A', stems_separated: false, source_url: 'https://example.com', source_platform: 'manual', date_added: null, rating: null, notes: null, tags: [], file_available: true, artwork_url: null, output_format: 'm4a', crate: null }], total: 1, limit: 500, offset: 0 })

    renderCrates()
    await userEvent.click(await screen.findByRole('button', { name: 'Organize Vault' }))
    await userEvent.click(screen.getByRole('button', { name: 'genre' }))
    await userEvent.click(await screen.findByRole('button', { name: /Jazz/ }))

    expect(screen.getByDisplayValue('Jazz')).toBeInTheDocument()
    expect(screen.getByText('Warm Loop')).toBeInTheDocument()
    expect(api.createCrate).not.toHaveBeenCalled()
  })
})
