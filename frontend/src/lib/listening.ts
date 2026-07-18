/**
 * Measure genuine playback between two media updates.
 *
 * Media jumps larger than two seconds are treated as seeks. Long wall-clock
 * gaps are treated as buffering or a suspended webview. Using the smaller of
 * the two clocks prevents either condition from inflating listening time.
 */
export function measuredListeningDelta(
  previousMediaSeconds: number | null,
  currentMediaSeconds: number,
  previousWallMs: number | null,
  currentWallMs: number,
) {
  if (previousMediaSeconds === null || previousWallMs === null) return 0
  const mediaDelta = currentMediaSeconds - previousMediaSeconds
  const wallDelta = (currentWallMs - previousWallMs) / 1000
  if (mediaDelta <= 0 || mediaDelta > 2 || wallDelta <= 0 || wallDelta > 2.5) return 0
  return Math.min(mediaDelta, wallDelta)
}
