import { beforeEach, describe, expect, it } from 'vitest'
import type { DiscoveryResponse, Suggestion } from '../lib/types'
import { useDigitalCrateStore } from './digitalCrate'

const suggestion = (id: string, title: string): Suggestion => ({
  discogs_master_id: Number(id), discogs_release_id: null, artist: 'Artist', title,
  year: 1974, country: 'US', genre: 'Jazz', style: 'Soul-Jazz',
  youtube_url: `https://youtube.com/watch?v=${id}`, youtube_video_id: id,
  youtube_title: title, youtube_duration_seconds: 180, match_score: 0.9,
  sample_score: 0.9, sample_reasons: [], artwork_url: null, discogs_url: null,
  sample_friendly: true, demo: false,
})

const reel = (...items: Suggestion[]): DiscoveryResponse => ({ items, demo: false, message: null })

describe('Digital Crate listening session', () => {
  beforeEach(() => useDigitalCrateStore.setState({
    items: [], message: null, demo: false, digRun: 0, appliedRun: 0,
    previewStates: {}, rejectedSources: {}, lockedSources: {}, rematching: {}, mpcJobs: {},
    playedVideoIds: [], listenedSeconds: {},
  }))

  it('marks a source played only after ten cumulative seconds of valid playback', () => {
    useDigitalCrateStore.getState().applyReel(1, reel(suggestion('1', 'One')))
    for (let count = 0; count < 9; count += 1) useDigitalCrateStore.getState().recordListening('1', 1)
    useDigitalCrateStore.getState().recordListening('1', 7) // rejected seek-sized jump
    expect(useDigitalCrateStore.getState()).toMatchObject({ listenedSeconds: { 1: 9 }, playedVideoIds: [] })

    useDigitalCrateStore.getState().recordListening('1', 1)
    useDigitalCrateStore.getState().recordListening('1', 1)
    expect(useDigitalCrateStore.getState()).toMatchObject({ listenedSeconds: { 1: 10 }, playedVideoIds: ['1'] })
  })

  it('keeps the first-listened shelf order stable through replays', () => {
    useDigitalCrateStore.getState().applyReel(1, reel(suggestion('1', 'One'), suggestion('2', 'Two')))
    for (let count = 0; count < 5; count += 1) useDigitalCrateStore.getState().recordListening('2', 2)
    for (let count = 0; count < 5; count += 1) useDigitalCrateStore.getState().recordListening('1', 2)
    useDigitalCrateStore.getState().recordListening('2', 1)
    expect(useDigitalCrateStore.getState().playedVideoIds).toEqual(['2', '1'])
  })

  it('resets played state after a successful dig and preserves it until then', () => {
    useDigitalCrateStore.getState().applyReel(1, reel(suggestion('1', 'One')))
    for (let count = 0; count < 5; count += 1) useDigitalCrateStore.getState().recordListening('1', 2)
    useDigitalCrateStore.getState().requestDig()
    expect(useDigitalCrateStore.getState().playedVideoIds).toEqual(['1'])

    useDigitalCrateStore.getState().applyReel(2, reel(suggestion('2', 'Two')))
    expect(useDigitalCrateStore.getState()).toMatchObject({ playedVideoIds: [], listenedSeconds: {} })
  })

  it('makes a rematched replacement unplayed without disturbing other shelf entries', () => {
    useDigitalCrateStore.getState().applyReel(1, reel(suggestion('1', 'One'), suggestion('2', 'Two')))
    for (const videoId of ['1', '2']) {
      for (let count = 0; count < 5; count += 1) useDigitalCrateStore.getState().recordListening(videoId, 2)
    }
    useDigitalCrateStore.getState().replaceSource(1, suggestion('9', 'Better One'))
    expect(useDigitalCrateStore.getState().playedVideoIds).toEqual(['2'])
    expect(useDigitalCrateStore.getState().listenedSeconds).toEqual({ 2: 10 })
    expect(useDigitalCrateStore.getState().items.map((item) => item.youtube_video_id)).toEqual(['9', '2'])
  })
})
