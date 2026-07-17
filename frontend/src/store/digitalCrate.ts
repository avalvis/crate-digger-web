import { create } from 'zustand'
import type { DiscoveryResponse, PreviewPrefetchItem, Suggestion } from '../lib/types'

export type ProducerProfile = 'boom_bap' | 'lofi' | 'global' | 'cinematic'
export type CrateView = 'list' | 'grid'

interface DigitalCrateState {
  profile: ProducerProfile
  era: number
  country: string
  genre: string
  view: CrateView
  items: Suggestion[]
  message: string | null
  demo: boolean
  digRun: number
  appliedRun: number
  previewStates: Record<string, PreviewPrefetchItem>
  setProfile: (value: ProducerProfile) => void
  setEra: (value: number) => void
  setCountry: (value: string) => void
  setGenre: (value: string) => void
  setView: (value: CrateView) => void
  requestDig: () => void
  ensureInitialDig: () => void
  applyReel: (run: number, response: DiscoveryResponse) => void
  setPreviewItems: (items: PreviewPrefetchItem[]) => void
  updatePreview: (item: PreviewPrefetchItem) => void
}

export const useDigitalCrateStore = create<DigitalCrateState>((set) => ({
  profile: 'boom_bap',
  era: 0,
  country: '',
  genre: '',
  view: 'list',
  items: [],
  message: null,
  demo: false,
  digRun: 0,
  appliedRun: 0,
  previewStates: {},
  setProfile: (profile) => set({ profile }),
  setEra: (era) => set({ era }),
  setCountry: (country) => set({ country }),
  setGenre: (genre) => set({ genre }),
  setView: (view) => set({ view }),
  requestDig: () => set((state) => ({ digRun: state.digRun + 1 })),
  ensureInitialDig: () => set((state) => state.digRun === 0 ? { digRun: 1 } : state),
  applyReel: (run, response) => set({
    items: response.items,
    message: response.message,
    demo: response.demo,
    appliedRun: run,
    previewStates: {},
  }),
  setPreviewItems: (items) => set((state) => ({
    previewStates: items.reduce((all, item) => ({ ...all, [item.video_id]: item }), state.previewStates),
  })),
  updatePreview: (item) => set((state) => ({
    previewStates: { ...state.previewStates, [item.video_id]: item },
  })),
}))
