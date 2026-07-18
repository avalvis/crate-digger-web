import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, mediaUrl } from '../lib/api'
import type { Track } from '../lib/types'
import { usePlayerStore } from '../store/player'
import { Vault } from './Vault'

vi.mock('../lib/api', () => ({
  api: {
    tracks: vi.fn(),
    track: vi.fn(),
    config: vi.fn(),
    patchTrack: vi.fn(),
    trackWaveform: vi.fn(),
  },
  mediaUrl: vi.fn(),
}))

vi.mock('../lib/desktop', () => ({ openFolder: vi.fn() }))

const track: Track = {
  id: 11,
  artist: 'Σάκης Τσιλίκης',
  title: 'Χωρίς αδιάβροχο',
  album: 'Rare Pressing',
  genre: 'Funk / Soul',
  style: 'Soul-Jazz',
  country: 'Greece',
  year: 1978,
  duration_seconds: 195,
  bpm: 80.75,
  musical_key: 'Cm',
  camelot_key: '5A',
  stems_separated: false,
  source_url: 'https://music.youtube.com/watch?v=gem',
  source_platform: 'youtube',
  date_added: '2026-07-18T22:03:17',
  rating: 0,
  notes: null,
  tags: [],
  file_available: true,
  artwork_url: '/api/tracks/11/artwork',
  output_format: 'm4a',
}

function renderVault() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Vault query="" /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Vault artwork and inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlayerStore.getState().clear()
    vi.mocked(api.tracks).mockResolvedValue({ items: [track], total: 1, limit: 250, offset: 0 })
    vi.mocked(api.track).mockResolvedValue(track)
    vi.mocked(api.config).mockResolvedValue({
      config: { general: { vault_root: 'C:\\Music\\Vault' }, downloader: {}, stems: {}, discovery: {}, export: {}, ui: {} },
      has_discogs_token: true,
      has_deepseek_key: false,
      keyring_available: true,
      engine_ready: true,
      engine_error: null,
    })
    vi.mocked(api.trackWaveform).mockResolvedValue({ peaks: [.1, .6], duration_seconds: 195 })
    vi.mocked(mediaUrl).mockImplementation(async (path) => `http://127.0.0.1:4983${path}?token=session`)
  })

  it('loads protected artwork and refreshes the selected track by id', async () => {
    renderVault()

    const rowTitle = await screen.findByText(track.title)
    await waitFor(() => expect(screen.getByAltText(`${track.artist} — ${track.title} cover`)).toHaveAttribute(
      'src', 'http://127.0.0.1:4983/api/tracks/11/artwork?token=session',
    ))

    await userEvent.click(rowTitle)
    await waitFor(() => expect(api.track).toHaveBeenCalledWith(11))
    expect(await screen.findByText('TRACK INSPECTOR')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Play track' }))
    await waitFor(() => expect(usePlayerStore.getState().track?.artworkUrl).toBe(
      'http://127.0.0.1:4983/api/tracks/11/artwork?token=session',
    ))
  })
})
