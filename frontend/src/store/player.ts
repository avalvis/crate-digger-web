import { create } from 'zustand'
import type { PreviewResponse, Suggestion } from '../lib/types'

export interface PlayerTrack {
  id: string
  title: string
  artist: string
  subtitle?: string
  artworkUrl?: string | null
  videoId?: string
  audioUrl?: string
  peaks?: number[]
  partial?: boolean
  discoverySuggestion?: Suggestion
}

interface PlayerState {
  track: PlayerTrack | null
  playlist: PlayerTrack[]
  currentIndex: number
  playing: boolean
  preparing: boolean
  requestedMode: 'quick' | 'full'
  requestToken: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: boolean
  spectrum: number[]
  setTrack: (track: PlayerTrack) => void
  playReel: (items: Suggestion[], selectedId: string, mode?: 'quick' | 'full') => void
  selectIndex: (index: number, mode?: 'quick' | 'full') => void
  selectRelative: (direction: -1 | 1) => void
  requestFull: () => void
  replaceReelSource: (masterId: number, suggestion: Suggestion) => void
  cachePrepared: (id: string, response: PreviewResponse, audioUrl: string, token: number) => void
  preparationFailed: (id: string, token: number) => void
  setPlaying: (playing: boolean) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  setSpectrum: (values: number[]) => void
  clear: () => void
}

function reelTrack(item: Suggestion, previous?: PlayerTrack): PlayerTrack {
  const id = `preview-${item.youtube_video_id}`
  return {
    id,
    title: item.title,
    artist: item.artist,
    subtitle: previous?.subtitle || 'Digital Crate preview',
    artworkUrl: item.artwork_url,
    videoId: item.youtube_video_id || undefined,
    audioUrl: previous?.audioUrl,
    peaks: previous?.peaks,
    partial: previous?.partial,
    discoverySuggestion: item,
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  track: null,
  playlist: [],
  currentIndex: -1,
  playing: false,
  preparing: false,
  requestedMode: 'quick',
  requestToken: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeat: false,
  spectrum: Array.from({ length: 48 }, () => 0.08),
  setTrack: (track) => set((state) => ({
    track,
    playlist: [track],
    currentIndex: 0,
    playing: true,
    preparing: !track.audioUrl,
    requestedMode: 'quick',
    requestToken: state.requestToken + 1,
  })),
  playReel: (items, selectedId, mode = 'quick') => set((state) => {
    const cached = new Map(state.playlist.map((item) => [item.id, item]))
    const playlist = items.filter((item) => item.youtube_video_id).map((item) => reelTrack(item, cached.get(`preview-${item.youtube_video_id}`)))
    const currentIndex = Math.max(0, playlist.findIndex((item) => item.id === selectedId))
    const track = playlist[currentIndex] || null
    const needsAudio = !!track && (!track.audioUrl || (mode === 'full' && track.partial !== false))
    return {
      playlist, currentIndex, track,
      requestedMode: mode,
      preparing: needsAudio,
      playing: !needsAudio,
      requestToken: state.requestToken + 1,
    }
  }),
  selectIndex: (index, mode = 'quick') => set((state) => {
    if (!state.playlist.length) return state
    const bounded = Math.max(0, Math.min(state.playlist.length - 1, index))
    const track = state.playlist[bounded]
    const needsAudio = !track.audioUrl || (mode === 'full' && track.partial !== false)
    return {
      currentIndex: bounded, track, requestedMode: mode,
      preparing: needsAudio, playing: !needsAudio,
      requestToken: state.requestToken + 1,
    }
  }),
  selectRelative: (direction) => {
    const state = get()
    if (state.playlist.length < 2) return
    let index: number
    if (state.shuffle) {
      const choices = state.playlist.map((_, value) => value).filter((value) => value !== state.currentIndex)
      index = choices[Math.floor(Math.random() * choices.length)]
    } else {
      index = (state.currentIndex + direction + state.playlist.length) % state.playlist.length
    }
    state.selectIndex(index)
  },
  requestFull: () => set((state) => state.track?.videoId ? ({
    requestedMode: 'full', preparing: state.track.partial !== false,
    playing: state.track.partial === false,
    requestToken: state.requestToken + 1,
  }) : state),
  replaceReelSource: (masterId, suggestion) => set((state) => {
    const replace = (item: PlayerTrack) => {
      if (item.discoverySuggestion?.discogs_master_id !== masterId) return item
      const sameAudio = item.videoId === suggestion.youtube_video_id
      return reelTrack(suggestion, sameAudio ? item : undefined)
    }
    return {
      playlist: state.playlist.map(replace),
      track: state.track ? replace(state.track) : null,
    }
  }),
  cachePrepared: (id, response, audioUrl, token) => set((state) => {
    const update = (item: PlayerTrack) => item.id === id ? {
      ...item, audioUrl, peaks: response.peaks, partial: response.partial,
      subtitle: response.partial ? 'Digital Crate preview' : 'Digital Crate · full track',
    } : item
    const playlist = state.playlist.map(update)
    if (state.track?.id !== id || state.requestToken !== token) return { playlist }
    const track = update(state.track)
    return { playlist, track, preparing: false, playing: true }
  }),
  preparationFailed: (id, token) => set((state) => (
    state.track?.id === id && state.requestToken === token ? { preparing: false, playing: false } : state
  )),
  setPlaying: (playing) => set({ playing }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)), muted: volume === 0 }),
  setMuted: (muted) => set({ muted }),
  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
  toggleRepeat: () => set((state) => ({ repeat: !state.repeat })),
  setSpectrum: (spectrum) => set({ spectrum }),
  clear: () => set((state) => ({
    track: null, playlist: [], currentIndex: -1, playing: false, preparing: false,
    requestToken: state.requestToken + 1,
  })),
}))
