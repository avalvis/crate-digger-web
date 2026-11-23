import { create } from 'zustand'

/**
 * Live analyser bands, kept apart from the player store: they change ~20×/s
 * during playback, and only the spectrum visual should re-render for them.
 */
interface SpectrumState {
  values: number[]
  setValues: (values: number[]) => void
}

export const IDLE_SPECTRUM = Array.from({ length: 48 }, () => 0.08)

export const useSpectrumStore = create<SpectrumState>((set) => ({
  values: IDLE_SPECTRUM,
  setValues: (values) => set({ values }),
}))
