import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListMusic, LoaderCircle, Pause, Play, RotateCcw, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { Slider } from 'radix-ui'
import { api, mediaUrl } from '../lib/api'
import { usePlayerStore } from '../store/player'
import { useToastStore } from '../store/toast'

function duration(value: number) {
  if (!Number.isFinite(value)) return '0:00'
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
}

export function PlayerBar({ onQueue }: { onQueue: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const wave = useRef<WaveSurfer | null>(null)
  const hydratedVolume = useRef(false)
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(0)
  const {
    track, playlist, currentIndex, playing, preparing, requestedMode, requestToken,
    volume, muted, shuffle, repeat, setPlaying, setVolume, setMuted,
    selectRelative, toggleShuffle, toggleRepeat, cachePrepared, preparationFailed,
    requestFull, setSpectrum, clear,
  } = usePlayerStore()
  const toast = useToastStore((state) => state.show)
  const config = useQuery({ queryKey: ['config'], queryFn: api.config })

  useEffect(() => {
    if (hydratedVolume.current || !config.data) return
    const saved = Number(config.data.config.ui.preview_volume)
    if (Number.isFinite(saved)) setVolume(saved)
    hydratedVolume.current = true
  }, [config.data, setVolume])

  useEffect(() => {
    if (!hydratedVolume.current) return
    const timer = window.setTimeout(() => {
      api.patchConfig('ui', { preview_volume: volume }).catch(() => undefined)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [volume])

  useEffect(() => {
    if (!track?.videoId || !preparing) return
    const id = track.id
    const token = requestToken
    let disposed = false
    api.preview(track.videoId, requestedMode)
      .then(async (prepared) => ({ prepared, audioUrl: await mediaUrl(prepared.audio_url) }))
      .then(({ prepared, audioUrl }) => {
        if (!disposed) {
          cachePrepared(id, prepared, audioUrl, token)
          if (track.discoverySuggestion) {
            api.recordDiscoveryInteraction(track.discoverySuggestion, 'preview').catch(() => undefined)
          }
        }
      })
      .catch((error) => {
        if (disposed) return
        preparationFailed(id, token)
        toast(error.message, 'error')
      })
    return () => { disposed = true }
  }, [track?.id, track?.videoId, track?.discoverySuggestion, preparing, requestedMode, requestToken, cachePrepared, preparationFailed, toast])

  useEffect(() => {
    if (!container.current || !track?.audioUrl) return
    wave.current?.destroy()
    setCurrent(0)
    setTotal(0)
    const media = document.createElement('audio')
    media.crossOrigin = 'anonymous'
    const regions = Regions.create()
    const instance = WaveSurfer.create({
      container: container.current,
      media,
      url: track.audioUrl,
      peaks: track.peaks?.length ? [track.peaks] : undefined,
      height: 32,
      waveColor: '#343530',
      progressColor: '#f4df00',
      cursorColor: '#ffffff',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      plugins: [regions],
    })
    instance.setVolume(muted ? 0 : volume)
    instance.on('ready', (seconds) => {
      setTotal(seconds)
      if (usePlayerStore.getState().playing) instance.play().catch(() => usePlayerStore.getState().setPlaying(false))
    })
    instance.on('timeupdate', setCurrent)
    instance.on('play', () => setPlaying(true))
    instance.on('pause', () => setPlaying(false))
    instance.on('finish', () => {
      const state = usePlayerStore.getState()
      if (state.repeat) {
        instance.setTime(0)
        instance.play()
      } else if (state.playlist.length > 1) {
        state.selectRelative(1)
      } else {
        state.setPlaying(false)
      }
    })

    let audioContext: AudioContext | undefined
    let frame = 0
    let lastPaint = 0
    const AudioContextClass = window.AudioContext
    if (AudioContextClass) {
      try {
        audioContext = new AudioContextClass()
        const source = audioContext.createMediaElementSource(media)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 128
        analyser.smoothingTimeConstant = 0.76
        source.connect(analyser)
        analyser.connect(audioContext.destination)
        const bins = new Uint8Array(analyser.frequencyBinCount)
        const paint = (now: number) => {
          frame = window.requestAnimationFrame(paint)
          if (now - lastPaint < 45 || !usePlayerStore.getState().playing) return
          lastPaint = now
          analyser.getByteFrequencyData(bins)
          const values = Array.from({ length: 48 }, (_, index) => {
            const sourceIndex = Math.min(bins.length - 1, Math.floor(index * bins.length / 48))
            return Math.max(0.08, bins[sourceIndex] / 255)
          })
          usePlayerStore.getState().setSpectrum(values)
        }
        frame = window.requestAnimationFrame(paint)
      } catch {
        audioContext = undefined
      }
    }
    wave.current = instance
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      audioContext?.close().catch(() => undefined)
      instance.destroy()
    }
  }, [track?.id, track?.audioUrl])

  useEffect(() => { wave.current?.setVolume(muted ? 0 : volume) }, [volume, muted])
  useEffect(() => {
    if (!wave.current || preparing) return
    if (playing && !wave.current.isPlaying()) wave.current.play().catch(() => setPlaying(false))
    if (!playing && wave.current.isPlaying()) wave.current.pause()
  }, [playing, preparing, setPlaying])

  const canNavigate = playlist.length > 1
  return (
    <footer className={`player-bar ${track ? 'player-bar--loaded' : ''}`}>
      <div className="player-track">
        <div className={`player-track__art vinyl-art ${playing ? 'is-playing' : ''}`}>
          {track?.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <span>{track ? track.artist.slice(0, 1) : 'CD'}</span>}
          <i />
        </div>
        <div><strong>{track?.title || 'Nothing playing'}</strong><span>{preparing ? 'Preparing audio…' : track?.artist || 'Dig something worth keeping'}</span></div>
      </div>
      <div className="transport">
        <div className="transport__buttons">
          <button className={shuffle ? 'active' : ''} aria-label="Shuffle" aria-pressed={shuffle} disabled={!canNavigate} onClick={toggleShuffle}><Shuffle size={15} /></button>
          <button aria-label="Previous" disabled={!canNavigate} onClick={() => selectRelative(-1)}><SkipBack size={18} /></button>
          <button className="transport__play" aria-label={playing ? 'Pause' : 'Play'} disabled={!track || preparing} onClick={() => setPlaying(!playing)}>
            {preparing ? <LoaderCircle size={18} className="spin" /> : playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button aria-label="Next" disabled={!canNavigate} onClick={() => selectRelative(1)}><SkipForward size={18} /></button>
          <button className={repeat ? 'active' : ''} aria-label="Repeat one" aria-pressed={repeat} disabled={!track} onClick={toggleRepeat}><RotateCcw size={15} /></button>
        </div>
        <div className="transport__wave"><span>{duration(current)}</span><div ref={container} /><span>{duration(total)}</span></div>
      </div>
      <div className="player-actions">
        {track?.videoId && track.partial !== false && <button className="player-full" disabled={preparing} onClick={requestFull}>Full track</button>}
        <button aria-label="Open ingestion queue" onClick={onQueue}><ListMusic size={17} /></button>
        <button aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)}>{muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        <Slider.Root className="volume" value={[volume]} max={1} step={0.01} onValueChange={([value]) => setVolume(value)}>
          <Slider.Track className="volume__track"><Slider.Range className="volume__range" /></Slider.Track>
          <Slider.Thumb className="volume__thumb" aria-label="Volume" />
        </Slider.Root>
        <span className="volume-value">{Math.round((muted ? 0 : volume) * 100)}%</span>
        {track && <button aria-label="Close player" onClick={clear}><X size={16} /></button>}
      </div>
    </footer>
  )
}
