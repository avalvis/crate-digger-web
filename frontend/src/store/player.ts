import { create } from 'zustand'

export interface PlayerTrack {
  id: string
  title: string
  artist: string
  subtitle?: string
  audioUrl: string
  peaks?: number[]
}

interface PlayerState {
  track: PlayerTrack | null
  playing: boolean
  volume: number
  setTrack: (track: PlayerTrack) => void
  setPlaying: (playing: boolean) => void
  setVolume: (volume: number) => void
  clear: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  track: null,
  playing: false,
  volume: 0.85,
  setTrack: (track) => set({ track, playing: true }),
  setPlaying: (playing) => set({ playing }),
  setVolume: (volume) => set({ volume }),
  clear: () => set({ track: null, playing: false }),
}))

