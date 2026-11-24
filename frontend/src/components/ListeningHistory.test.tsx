import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import type { Suggestion } from '../lib/types'
import { useDigitalCrateStore } from '../store/digitalCrate'
import { KeepButton, ListeningHistory } from './ListeningHistory'

vi.mock('../lib/api', () => ({ api: { setLiked: vi.fn(), listening: vi.fn() } }))

const record = (id: string, title: string): Suggestion => ({
  discogs_master_id: title.length, discogs_release_id: null, artist: 'Artist', title,
  year: 1974, country: 'GR', genre: 'Jazz', style: null,
  youtube_url: `https://youtube.com/watch?v=${id}`, youtube_video_id: id,
  youtube_title: title, youtube_duration_seconds: 180, match_score: 0.9,
  sample_score: 0.9, sample_reasons: [], artwork_url: null, discogs_url: null,
  sample_friendly: true, demo: false,
})

function mount(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  useDigitalCrateStore.setState({ likedVideoIds: [] })
})

describe('keeping records', () => {
  it('keeps and un-keeps a record, saving it for History', async () => {
    vi.mocked(api.setLiked).mockResolvedValue(undefined)
    const item = record('dQw4w9WgXcQ', 'Dusty Loop')
    mount(<KeepButton item={item} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep Artist — Dusty Loop' }))
    expect(screen.getByRole('button', { name: 'Remove from kept Artist — Dusty Loop' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(api.setLiked).toHaveBeenCalledWith(item, true))
    expect(useDigitalCrateStore.getState().likedVideoIds).toEqual(['dQw4w9WgXcQ'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove from kept Artist — Dusty Loop' }))
    await waitFor(() => expect(api.setLiked).toHaveBeenLastCalledWith(item, false))
    expect(useDigitalCrateStore.getState().likedVideoIds).toEqual([])
  })

  it('rolls the heart back when saving fails', async () => {
    vi.mocked(api.setLiked).mockRejectedValue(new Error('offline'))
    mount(<KeepButton item={record('dQw4w9WgXcQ', 'Dusty Loop')} />)
    fireEvent.click(screen.getByRole('button', { name: /^Keep/ }))
    await waitFor(() => expect(useDigitalCrateStore.getState().likedVideoIds).toEqual([]))
  })
})

describe('listening history', () => {
  it('lists played and kept records and plays from them', async () => {
    const played = record('dQw4w9WgXcQ', 'Heard Twice')
    const kept = record('9bZkp7q19f0', 'Kept Gem')
    vi.mocked(api.listening).mockImplementation(async (filter) => ({
      items: filter === 'liked'
        ? [{ suggestion: kept, play_count: 0, liked: true, first_played_at: null, last_played_at: null, liked_at: new Date().toISOString() }]
        : [
          { suggestion: played, play_count: 2, liked: false, first_played_at: null, last_played_at: new Date().toISOString(), liked_at: null },
          { suggestion: kept, play_count: 0, liked: true, first_played_at: null, last_played_at: null, liked_at: new Date().toISOString() },
        ],
      total: filter === 'liked' ? 1 : 2, limit: 200, offset: 0,
    }))
    const onPlay = vi.fn()
    mount(<ListeningHistory open onOpenChange={() => undefined} onPlay={onPlay} onQueue={vi.fn()} onMpc={vi.fn()} />)
    expect(await screen.findByText('Heard Twice')).toBeInTheDocument()
    expect(screen.getByText(/Played 2× · today/)).toBeInTheDocument()
    expect(screen.getByText(/not played yet/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Play Artist — Heard Twice' }))
    expect(onPlay).toHaveBeenCalledWith([played, kept], played)

    fireEvent.click(screen.getByRole('tab', { name: /Kept/ }))
    await waitFor(() => expect(screen.queryByText('Heard Twice')).toBeNull())
    expect(await screen.findByText('Kept Gem')).toBeInTheDocument()
  })
})
