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
  playedVideoIds: string[]
  listenedSeconds: Record<string, number>
  setProfile: (value: ProducerProfile) => void
  setEra: (value: number) => void
  setCountry: (value: string) => void
  setGenre: (value: string) => void
  setView: (value: CrateView) => void
  requestDig: () => void
  applyReel: (run: number, response: DiscoveryResponse) => void
  replaceSource: (masterId: number, suggestion: Suggestion) => void
  recordListening: (videoId: string, seconds: number) => void
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
  playedVideoIds: [],
  listenedSeconds: {},
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
    playedVideoIds: [],
    listenedSeconds: {},
  }),
  replaceSource: (masterId, suggestion) => set((state) => {
    const previous = state.items.find((item) => item.discogs_master_id === masterId)
    const previewStates = { ...state.previewStates }
    const listenedSeconds = { ...state.listenedSeconds }
    if (previous?.youtube_video_id) delete previewStates[previous.youtube_video_id]
    if (previous?.youtube_video_id) delete listenedSeconds[previous.youtube_video_id]
    return {
      items: state.items.map((item) => item.discogs_master_id === masterId ? suggestion : item),
      previewStates,
      listenedSeconds,
      playedVideoIds: state.playedVideoIds.filter((videoId) => videoId !== previous?.youtube_video_id),
    }
  }),
  recordListening: (videoId, seconds) => set((state) => {
    if (!videoId || !Number.isFinite(seconds) || seconds <= 0 || seconds > 2) return state
    if (!state.items.some((item) => item.youtube_video_id === videoId)) return state
    if (state.playedVideoIds.includes(videoId)) return state
    const total = Math.min(10, (state.listenedSeconds[videoId] || 0) + seconds)
    return {
      listenedSeconds: { ...state.listenedSeconds, [videoId]: total },
      playedVideoIds: total >= 10 ? [...state.playedVideoIds, videoId] : state.playedVideoIds,
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
