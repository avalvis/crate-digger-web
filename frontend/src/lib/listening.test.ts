import { describe, expect, it } from 'vitest'
import { measuredListeningDelta } from './listening'

describe('measuredListeningDelta', () => {
  it('requires a baseline before counting playback', () => {
    expect(measuredListeningDelta(null, 4, null, 1_000)).toBe(0)
  })

  it('counts only the time supported by both the media and wall clocks', () => {
    expect(measuredListeningDelta(4, 4.8, 1_000, 1_750)).toBeCloseTo(0.75)
  })

  it('does not count seeks, rewinds, or suspended playback gaps', () => {
    expect(measuredListeningDelta(4, 18, 1_000, 1_100)).toBe(0)
    expect(measuredListeningDelta(4, 3, 1_000, 1_100)).toBe(0)
    expect(measuredListeningDelta(4, 5, 1_000, 5_000)).toBe(0)
  })
})
