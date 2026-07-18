import { beforeEach, describe, expect, it } from 'vitest'
import { usePlayerStore } from './player'
import type { Suggestion } from '../lib/types'

const suggestion = (id: string, title: string): Suggestion => ({
  discogs_master_id: Number(id), discogs_release_id: null, artist: 'Artist', title,
  year: 1974, country: 'US', genre: 'Jazz', style: 'Soul-Jazz',
  youtube_url: `https://youtube.com/watch?v=${id}`, youtube_video_id: id,
  youtube_title: title, youtube_duration_seconds: 180, match_score: 0.9,
  sample_score: 0.9, sample_reasons: [], artwork_url: null, discogs_url: null,
  sample_friendly: true, demo: false,
})

describe('global player store', () => {
  beforeEach(() => usePlayerStore.setState({ track: null, playlist: [], currentIndex: -1, playing: false, preparing: false, volume: 0.85 }))

  it('replaces the current source so only one track can be active', () => {
    usePlayerStore.getState().setTrack({ id: 'one', artist: 'A', title: 'One', audioUrl: '/one' })
    usePlayerStore.getState().setTrack({ id: 'two', artist: 'B', title: 'Two', audioUrl: '/two' })
    expect(usePlayerStore.getState().track?.id).toBe('two')
    expect(usePlayerStore.getState().playing).toBe(true)
  })

  it('preserves bounded volume state', () => {
    usePlayerStore.getState().setVolume(0.42)
    expect(usePlayerStore.getState().volume).toBe(0.42)
  })

  it('navigates the original reel order and wraps at the ends', () => {
    const items = [suggestion('1', 'One'), suggestion('2', 'Two'), suggestion('3', 'Three')]
    usePlayerStore.getState().playReel(items, 'preview-2')
    expect(usePlayerStore.getState().track?.title).toBe('Two')
    usePlayerStore.getState().selectRelative(1)
    expect(usePlayerStore.getState().track?.title).toBe('Three')
    usePlayerStore.getState().selectRelative(1)
    expect(usePlayerStore.getState().track?.title).toBe('One')
    usePlayerStore.getState().selectRelative(-1)
    expect(usePlayerStore.getState().track?.title).toBe('Three')
  })

  it('does not let a stale preview response steal the current selection', () => {
    const items = [suggestion('1', 'One'), suggestion('2', 'Two')]
    usePlayerStore.getState().playReel(items, 'preview-1')
    const staleToken = usePlayerStore.getState().requestToken
    usePlayerStore.getState().selectIndex(1)
    usePlayerStore.getState().cachePrepared('preview-1', {
      video_id: '1', audio_url: '/one', peaks: [0.2], duration_seconds: 45, partial: true,
    }, '/one', staleToken)
    expect(usePlayerStore.getState().track?.id).toBe('preview-2')
    expect(usePlayerStore.getState().playing).toBe(false)
    expect(usePlayerStore.getState().playlist[0].audioUrl).toBe('/one')
  })

  it('keeps the full-track media when navigating away and back', () => {
    const items = [suggestion('1', 'One'), suggestion('2', 'Two')]
    usePlayerStore.getState().playReel(items, 'preview-1')
    const quickToken = usePlayerStore.getState().requestToken
    usePlayerStore.getState().cachePrepared('preview-1', {
      video_id: '1', audio_url: '/one', peaks: [0.2], duration_seconds: 45, partial: true,
    }, '/one?variant=quick', quickToken)

    usePlayerStore.getState().requestFull()
    const fullToken = usePlayerStore.getState().requestToken
    expect(usePlayerStore.getState()).toMatchObject({ preparing: true, playing: false, requestedMode: 'full' })
    usePlayerStore.getState().cachePrepared('preview-1', {
      video_id: '1', audio_url: '/one', peaks: [0.4], duration_seconds: 240, partial: false,
    }, '/one?variant=full', fullToken)

    usePlayerStore.getState().selectRelative(1)
    const nextToken = usePlayerStore.getState().requestToken
    usePlayerStore.getState().cachePrepared('preview-2', {
      video_id: '2', audio_url: '/two', peaks: [0.3], duration_seconds: 45, partial: true,
    }, '/two?variant=quick', nextToken)
    usePlayerStore.getState().selectRelative(-1)

    expect(usePlayerStore.getState().track).toMatchObject({
      id: 'preview-1', audioUrl: '/one?variant=full', partial: false,
      subtitle: 'Digital Crate · full track',
    })
    expect(usePlayerStore.getState()).toMatchObject({ preparing: false, playing: true })
  })

  it('replaces a rematched source in its canonical slot without reordering the reel', () => {
    const items = [suggestion('1', 'One'), suggestion('2', 'Two'), suggestion('3', 'Three')]
    usePlayerStore.getState().playReel(items, 'preview-2')
    usePlayerStore.getState().replaceReelSource(1, suggestion('9', 'Better One'))

    expect(usePlayerStore.getState().playlist.map((item) => item.title)).toEqual(['Better One', 'Two', 'Three'])
    expect(usePlayerStore.getState().track?.title).toBe('Two')
    usePlayerStore.getState().selectRelative(-1)
    expect(usePlayerStore.getState().track).toMatchObject({ id: 'preview-9', title: 'Better One' })
  })
})
