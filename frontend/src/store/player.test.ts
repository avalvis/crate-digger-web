import { beforeEach, describe, expect, it } from 'vitest'
import { usePlayerStore } from './player'

describe('global player store', () => {
  beforeEach(() => usePlayerStore.setState({ track: null, playing: false, volume: 0.85 }))

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
})

