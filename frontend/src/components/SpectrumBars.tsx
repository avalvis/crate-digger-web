import { memo } from 'react'
import { useSpectrumStore } from '../store/spectrum'

const RESTING = Array.from({ length: 48 }, (_, index) => 0.12 + ((index * 17) % 42) / 100)

/** Animated hero wave. Subscribes to the analyser only while playing. */
export const SpectrumBars = memo(function SpectrumBars({ active }: { active: boolean }) {
  const values = useSpectrumStore((state) => (active ? state.values : RESTING))
  return <div className="hero-wave" aria-hidden="true">{values.map((value, index) => <i key={index} style={{ transform: `scaleY(${Math.max(0.08, value)})` }} />)}</div>
})
