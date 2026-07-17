import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { ConfigResponse } from '../lib/types'
import { DigitalCrate } from './DigitalCrate'
import { useDigitalCrateStore } from '../store/digitalCrate'
import { usePlayerStore } from '../store/player'

vi.mock('../lib/api', () => ({
  api: {
    config: vi.fn(),
    dig: vi.fn(),
    enqueue: vi.fn(),
    preview: vi.fn(),
    prefetchPreviews: vi.fn(),
  },
  mediaUrl: vi.fn(),
}))

const config = (hasDiscogsToken: boolean): ConfigResponse => ({
  config: { general: {}, downloader: {}, stems: {}, discovery: {}, export: {}, ui: {} },
  has_discogs_token: hasDiscogsToken,
  has_deepseek_key: false,
  keyring_available: true,
  engine_ready: false,
  engine_error: null,
})

function renderCrate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><DigitalCrate /></MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

describe('DigitalCrate startup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDigitalCrateStore.setState({ items: [], message: null, demo: false, digRun: 0, appliedRun: 0, previewStates: {} })
    usePlayerStore.getState().clear()
    vi.mocked(api.prefetchPreviews).mockResolvedValue({ items: [] })
  })

  it('does not start a fake dig when the independent profile has no Discogs token', async () => {
    vi.mocked(api.config).mockResolvedValue(config(false))

    renderCrate()

    expect(await screen.findByText('Connect Discogs to dig live gems')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Discogs token' })).toBeInTheDocument()
    expect(api.dig).not.toHaveBeenCalled()
  })

  it('starts exactly one durable dig under React Strict Mode', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    vi.mocked(api.dig).mockResolvedValue({ items: [], demo: false, message: null })

    renderCrate()

    await waitFor(() => expect(api.dig).toHaveBeenCalledTimes(1))
    await screen.findByText('Waiting for the next pull')
    expect(api.dig).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'boom_bap',
      prioritize_samples: true,
      sample_intensity: 0.9,
    }))
  })

  it('keeps the fetched reel when the route component is remounted', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    useDigitalCrateStore.setState({
      digRun: 1, appliedRun: 1,
      items: [{
        discogs_master_id: 42, discogs_release_id: 43, artist: 'Dorothy Ashby', title: 'Afro-Harping',
        year: 1968, country: 'US', genre: 'Jazz', style: 'Soul-Jazz',
        youtube_url: 'https://youtube.com/watch?v=gem42', youtube_video_id: 'gem42', youtube_title: 'Afro-Harping',
        youtube_duration_seconds: 180, match_score: .95, sample_score: .98, sample_reasons: ['harp texture'],
        artwork_url: null, discogs_url: null, sample_friendly: true, demo: false,
      }],
    })
    const first = renderCrate()
    expect(await screen.findByText('Afro-Harping')).toBeInTheDocument()
    first.unmount()
    renderCrate()
    expect(await screen.findByText('Afro-Harping')).toBeInTheDocument()
    expect(api.dig).not.toHaveBeenCalled()
  })
})
