import { useEffect, useRef } from 'react'
import { Heart, ListMusic, Pause, Play, RotateCcw, Shuffle, SkipBack, SkipForward, Volume2, X } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { Slider } from 'radix-ui'
import { usePlayerStore } from '../store/player'

function duration(value: number) {
  if (!Number.isFinite(value)) return '0:00'
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
}

export function PlayerBar() {
  const container = useRef<HTMLDivElement>(null)
  const wave = useRef<WaveSurfer | null>(null)
  const { track, playing, volume, setPlaying, setVolume, clear } = usePlayerStore()
  const current = useRef(0)
  const total = useRef(0)

  useEffect(() => {
    if (!container.current || !track) return
    wave.current?.destroy()
    const regions = Regions.create()
    const instance = WaveSurfer.create({
      container: container.current,
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
    instance.setVolume(volume)
    instance.on('ready', (seconds) => { total.current = seconds; if (playing) instance.play() })
    instance.on('timeupdate', (seconds) => { current.current = seconds })
    instance.on('play', () => setPlaying(true))
    instance.on('pause', () => setPlaying(false))
    instance.on('finish', () => setPlaying(false))
    wave.current = instance
    return () => instance.destroy()
  }, [track?.id])

  useEffect(() => { wave.current?.setVolume(volume) }, [volume])
  useEffect(() => {
    if (!wave.current) return
    if (playing && !wave.current.isPlaying()) wave.current.play()
    if (!playing && wave.current.isPlaying()) wave.current.pause()
  }, [playing])

  return (
    <footer className={`player-bar ${track ? 'player-bar--loaded' : ''}`}>
      <div className="player-track">
        <div className="player-track__art">{track ? track.artist.slice(0, 1) : 'CD'}</div>
        <div><strong>{track?.title || 'Nothing playing'}</strong><span>{track?.artist || 'Dig something worth keeping'}</span></div>
      </div>
      <div className="transport">
        <div className="transport__buttons">
          <button aria-label="Shuffle"><Shuffle size={15} /></button>
          <button aria-label="Previous"><SkipBack size={18} /></button>
          <button className="transport__play" aria-label={playing ? 'Pause' : 'Play'} disabled={!track} onClick={() => setPlaying(!playing)}>
            {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button aria-label="Next"><SkipForward size={18} /></button>
          <button aria-label="Repeat"><RotateCcw size={15} /></button>
        </div>
        <div className="transport__wave"><span>{duration(current.current)}</span><div ref={container} /><span>{duration(total.current)}</span></div>
      </div>
      <div className="player-actions">
        <button aria-label="Favorite"><Heart size={17} /></button>
        <button aria-label="Queue"><ListMusic size={17} /></button>
        <Volume2 size={17} />
        <Slider.Root className="volume" value={[volume]} max={1} step={0.01} onValueChange={([value]) => setVolume(value)}>
          <Slider.Track><Slider.Range /></Slider.Track><Slider.Thumb aria-label="Volume" />
        </Slider.Root>
        {track && <button aria-label="Close player" onClick={clear}><X size={16} /></button>}
      </div>
    </footer>
  )
}

