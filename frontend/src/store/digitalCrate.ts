import { create } from 'zustand'
import type { DiscoveryResponse, MpcJob, PreviewPrefetchItem, Suggestion } from '../lib/types'

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
  rejectedSources: Record<number, string[]>
  lockedSources: Record<number, string>
  rematching: Record<number, boolean>
  mpcJobs: Record<string, MpcJob>
  setProfile: (value: ProducerProfile) => void
  setEra: (value: number) => void
  setCountry: (value: string) => void
  setGenre: (value: string) => void
  setView: (value: CrateView) => void
  requestDig: () => void
  applyReel: (run: number, response: DiscoveryResponse) => void
  replaceSource: (masterId: number, suggestion: Suggestion) => void
  rejectSource: (masterId: number, videoId: string) => void
  setRematching: (masterId: number, active: boolean) => void
  lockSource: (masterId: number, videoId: string) => void
  setMpcJobs: (jobs: MpcJob[]) => void
  updateMpcJob: (job: MpcJob) => void
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
  rejectedSources: {},
  lockedSources: {},
  rematching: {},
  mpcJobs: {},
  setProfile: (profile) => set({ profile }),
  setEra: (era) => set({ era }),
  setCountry: (country) => set({ country }),
  setGenre: (genre) => set({ genre }),
  setView: (view) => set({ view }),
  requestDig: () => set((state) => ({ digRun: state.digRun + 1 })),
  applyReel: (run, response) => set({
    items: response.items,
    message: response.message,
    demo: response.demo,
    appliedRun: run,
    previewStates: {},
    rejectedSources: {},
    lockedSources: {},
    rematching: {},
  }),
  replaceSource: (masterId, suggestion) => set((state) => {
    const previous = state.items.find((item) => item.discogs_master_id === masterId)
    const previewStates = { ...state.previewStates }
    if (previous?.youtube_video_id) delete previewStates[previous.youtube_video_id]
    return {
      items: state.items.map((item) => item.discogs_master_id === masterId ? suggestion : item),
      previewStates,
    }
  }),
  rejectSource: (masterId, videoId) => set((state) => ({
    rejectedSources: {
      ...state.rejectedSources,
      [masterId]: Array.from(new Set([...(state.rejectedSources[masterId] || []), videoId])),
    },
  })),
  setRematching: (masterId, active) => set((state) => ({
    rematching: { ...state.rematching, [masterId]: active },
  })),
  lockSource: (masterId, videoId) => set((state) => ({
    lockedSources: { ...state.lockedSources, [masterId]: videoId },
  })),
  setMpcJobs: (jobs) => set({
    mpcJobs: jobs.reduce((all, job) => ({ ...all, [job.video_id]: job }), {} as Record<string, MpcJob>),
  }),
  updateMpcJob: (job) => set((state) => ({
    mpcJobs: { ...state.mpcJobs, [job.video_id]: job },
  })),
  setPreviewItems: (items) => set((state) => ({
    previewStates: items.reduce((all, item) => ({ ...all, [item.video_id]: item }), state.previewStates),
  })),
  updatePreview: (item) => set((state) => ({
    previewStates: { ...state.previewStates, [item.video_id]: item },
  })),
}))
