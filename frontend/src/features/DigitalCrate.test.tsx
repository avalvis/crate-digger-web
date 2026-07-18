import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
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
    rematch: vi.fn(),
    recordDiscoveryInteraction: vi.fn(),
    enqueueMpc: vi.fn(),
    cancelMpc: vi.fn(),
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

const suggestion = (id: string, title: string) => ({
  discogs_master_id: Number(id), discogs_release_id: null, artist: 'Artist', title,
  year: 1974, country: 'US', genre: 'Jazz', style: 'Soul-Jazz',
  youtube_url: `https://youtube.com/watch?v=${id}`, youtube_video_id: id,
  youtube_title: title, youtube_duration_seconds: 180, match_score: 0.9,
  sample_score: 0.9, sample_reasons: [], artwork_url: null, discogs_url: null,
  sample_friendly: true, demo: false,
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
    useDigitalCrateStore.setState({
      items: [], message: null, demo: false, digRun: 0, appliedRun: 0, previewStates: {},
      rejectedSources: {}, lockedSources: {}, rematching: {}, mpcJobs: {}, playedVideoIds: [], listenedSeconds: {},
    })
    usePlayerStore.getState().clear()
    vi.mocked(api.prefetchPreviews).mockResolvedValue({ items: [] })
  })

  it('does not start a fake dig when the independent profile has no Discogs token', async () => {
    vi.mocked(api.config).mockResolvedValue(config(false))

    renderCrate()

    expect(await screen.findByText('Your crate is empty')).toBeInTheDocument()
    expect(screen.getByAltText('A crate filled with records')).toBeInTheDocument()
    expect((await screen.findAllByRole('button', { name: 'Add Discogs token' })).length).toBeGreaterThan(0)
    expect(api.dig).not.toHaveBeenCalled()
  })

  it('waits for a manual Dig and starts exactly one request under React Strict Mode', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    vi.mocked(api.dig).mockResolvedValue({ items: [], demo: false, message: null })

    renderCrate()

    await screen.findByText('Your crate is empty')
    expect(api.dig).not.toHaveBeenCalled()
    await userEvent.click(screen.getAllByRole('button', { name: 'Dig for gems' })[0])
    await waitFor(() => expect(api.dig).toHaveBeenCalledTimes(1))
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

  it('separates unplayed and played records while keeping the active record in the hero', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    useDigitalCrateStore.setState({
      items: [suggestion('1', 'One'), suggestion('2', 'Two'), suggestion('3', 'Three')],
      playedVideoIds: ['1'], listenedSeconds: { 1: 10 },
    })
    usePlayerStore.getState().playReel(useDigitalCrateStore.getState().items, 'preview-2')

    renderCrate()

    expect(await screen.findByRole('heading', { name: 'Two' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Up next' })).getByText('Three')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Played this session' })).getByRole('button', { name: 'Replay Artist — One' })).toBeInTheDocument()
    expect(screen.getByText(/NOW PLAYING · 2 OF 3/)).toBeInTheDocument()
  })

  it('shows the completion state after the full playable reel is auditioned', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    useDigitalCrateStore.setState({
      items: [suggestion('1', 'One'), suggestion('2', 'Two')],
      playedVideoIds: ['1', '2'], listenedSeconds: { 1: 10, 2: 10 },
    })

    renderCrate()

    expect(await screen.findByText('Crate auditioned')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Played this session' })).toBeInTheDocument()
  })

  it('scrolls to the hero for a new crate selection but not for pause or resume', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1 })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
    useDigitalCrateStore.setState({ items: [suggestion('1', 'One'), suggestion('2', 'Two')] })

    renderCrate()
    await userEvent.click(await screen.findByRole('button', { name: 'Play Artist — Two' }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))

    act(() => usePlayerStore.getState().setPlaying(false))
    act(() => usePlayerStore.getState().setPlaying(true))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    act(() => usePlayerStore.getState().selectRelative(-1))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2))
  })

  it('asks for a Vault format before queueing a Digital Crate track', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    vi.mocked(api.enqueue).mockResolvedValue({ id: 1 } as never)
    vi.mocked(api.recordDiscoveryInteraction).mockResolvedValue(undefined as never)
    useDigitalCrateStore.setState({ items: [suggestion('1', 'One')] })

    renderCrate()
    await userEvent.click(await screen.findByRole('button', { name: 'Queue' }))

    expect(screen.getByRole('heading', { name: 'Queue track' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /M4A/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /MP3/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Queue as MP3' }))

    await waitFor(() => expect(api.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      output_format: 'mp3', enable_stems: false,
    })))
  })

  it('preserves the stems intent while asking for the output format', async () => {
    vi.mocked(api.config).mockResolvedValue(config(true))
    vi.mocked(api.enqueue).mockResolvedValue({ id: 2 } as never)
    vi.mocked(api.recordDiscoveryInteraction).mockResolvedValue(undefined as never)
    useDigitalCrateStore.setState({ items: [suggestion('1', 'One')] })

    renderCrate()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Artist — One' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Queue + stems' }))

    expect(screen.getByRole('heading', { name: 'Queue track + stems' })).toBeInTheDocument()
    expect(screen.getByText('Stem separation included')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /WAV/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Queue as WAV \+ stems' }))

    await waitFor(() => expect(api.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      output_format: 'wav', enable_stems: true,
    })))
  })
})
