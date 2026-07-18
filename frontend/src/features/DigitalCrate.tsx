import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Dialog, DropdownMenu } from 'radix-ui'
import {
  Check, Copy, Cpu, Disc3, FileAudio, FolderOpen, Grid2X2, Headphones, List, LoaderCircle, MoreVertical,
  Play, Plus, RefreshCw, RotateCcw, SlidersHorizontal, Waves, WandSparkles, X,
} from 'lucide-react'
import crateArtwork from '../../../assets/crate.png'
import { api } from '../lib/api'
import { openExternal, openFolder } from '../lib/desktop'
import type { MpcExportMode, MpcJob, PreviewPrefetchItem, Suggestion } from '../lib/types'
import { useDigitalCrateStore } from '../store/digitalCrate'
import { usePlayerStore } from '../store/player'
import { useToastStore } from '../store/toast'

const profiles = [
  ['boom_bap', 'Boom-bap gold'], ['lofi', 'Lo-fi textures'],
  ['global', 'Global deep cuts'], ['cinematic', 'Cinematic / library'],
] as const
const eras = [
  ['All source eras', undefined, undefined], ['Golden source · 1960–79', 1960, 1979],
  ['Dusty early · 1945–64', 1945, 1964], ['Seventies · 1970–79', 1970, 1979],
  ['Eighties · 1980–89', 1980, 1989],
] as const
const countries = ['', 'Greece', 'Brazil', 'Japan', 'France', 'Italy', 'Turkey', 'Nigeria', 'Ghana', 'Ethiopia', 'Jamaica', 'India']
type OutputFormat = 'm4a' | 'mp3' | 'wav'

function initials(item: Suggestion) { return item.artist.split(/\s+/).slice(0, 2).map((word) => word[0]).join('') }
function artClass(index: number) { return `record-art record-art--${(index % 4) + 1}` }

function RecordArtwork({ item, index, featured = false, playing = false }: { item?: Suggestion; index: number; featured?: boolean; playing?: boolean }) {
  return <div className={`${artClass(index)} ${featured ? 'featured-dig__art vinyl-art' : ''} ${playing ? 'is-playing' : ''}`}>
    {item?.artwork_url ? <img src={item.artwork_url} alt={`${item.artist} — ${item.title} cover`} loading="lazy" /> : <><span>{item ? initials(item) : 'CD'}</span><i /></>}
    {featured && <b className="vinyl-spindle" />}
  </div>
}

function SampleReasons({ item }: { item: Suggestion }) {
  const reasons = item.sample_reasons || []
  if (!reasons.length) return <div className="sample-label">• producer-ranked source</div>
  return <div className="sample-reasons">{reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
}

function previewLabel(state?: PreviewPrefetchItem, active?: boolean, preparing?: boolean) {
  if (active && preparing) return 'Preparing…'
  if (active) return 'Playing'
  if (state?.state === 'ready') return 'Play'
  if (state?.state === 'failed') return 'Retry preview'
  if (state?.state === 'downloading' || state?.state === 'decoding') return `Warming ${Math.round(state.percent)}%`
  return 'Preview'
}

function mpcLabel(job?: MpcJob) {
  if (!job) return 'MPC Workflow'
  if (job.state === 'queued') return 'MPC queued'
  if (job.state === 'running') return `MPC ${Math.round(job.percent)}%`
  if (job.state === 'completed') return 'MPC export complete'
  if (job.state === 'failed') return 'Retry MPC Workflow'
  return 'MPC Workflow'
}

interface ActionMenuProps {
  item: Suggestion
  queueing: boolean
  rematching: boolean
  locked: boolean
  mpcJob?: MpcJob
  onQueue: (item: Suggestion, stems?: boolean) => void
  onRematch: (item: Suggestion) => void
  onMpc: (item: Suggestion) => void
  onCancelMpc: (job: MpcJob) => void
}

function SongActionMenu({ item, queueing, rematching, locked, mpcJob, onQueue, onRematch, onMpc, onCancelMpc }: ActionMenuProps) {
  const mpcActive = mpcJob?.state === 'queued' || mpcJob?.state === 'running'
  return <DropdownMenu.Root><DropdownMenu.Trigger className="icon-button dig-card__more" aria-label={`More actions for ${item.artist} — ${item.title}`}><MoreVertical size={18} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu-content" sideOffset={7}>
    <DropdownMenu.Item disabled={!item.youtube_url || queueing} onSelect={() => onQueue(item, true)}><WandSparkles size={13} /> Queue + stems</DropdownMenu.Item>
    <DropdownMenu.Item disabled={!item.youtube_video_id || rematching || locked} onSelect={() => onRematch(item)}><RefreshCw size={13} className={rematching ? 'spin' : ''} /> {rematching ? 'Searching…' : locked ? 'Audio source locked' : 'Find better audio'}</DropdownMenu.Item>
    <DropdownMenu.Item disabled={!item.youtube_video_id || !!mpcActive} onSelect={() => onMpc(item)}><Cpu size={13} /> {mpcLabel(mpcJob)}</DropdownMenu.Item>
    {mpcActive && <DropdownMenu.Item onSelect={() => onCancelMpc(mpcJob!)}><X size={13} /> Cancel MPC export</DropdownMenu.Item>}
    {mpcJob?.state === 'completed' && mpcJob.track_dir && <DropdownMenu.Item onSelect={() => openFolder(mpcJob.track_dir!).catch(() => undefined)}><FolderOpen size={13} /> Open MPC folder</DropdownMenu.Item>}
    <DropdownMenu.Separator className="menu-separator" />
    <DropdownMenu.Item onSelect={() => navigator.clipboard.writeText(`${item.artist} — ${item.title}`)}><Copy size={13} /> Copy track name</DropdownMenu.Item>
    <DropdownMenu.Item disabled={!item.youtube_url} onSelect={() => item.youtube_url && openExternal(item.youtube_url)}>Open YouTube</DropdownMenu.Item>
    <DropdownMenu.Item disabled={!item.discogs_url} onSelect={() => item.discogs_url && openExternal(item.discogs_url)}>Open Discogs</DropdownMenu.Item>
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}

function MpcModeDialog({ item, mode, open, onMode, onOpenChange, onConfirm, busy, onSettings }: {
  item: Suggestion | null; mode: MpcExportMode; open: boolean; busy: boolean
  onMode: (mode: MpcExportMode) => void; onOpenChange: (open: boolean) => void
  onConfirm: () => void; onSettings: () => void
}) {
  const options: Array<[MpcExportMode, string, string]> = [
    ['song', 'Original song only', 'Full track converted to MPC-ready WAV.'],
    ['stems', 'Stems only', 'First 120 seconds separated into four stems.'],
    ['both', 'Both', 'Original song plus the 120-second stem set. Recommended.'],
  ]
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="mpc-dialog">
    <div className="panel-heading"><div><span className="eyebrow">DIRECT SAMPLE WORKFLOW</span><Dialog.Title>Export to MPC folder</Dialog.Title><Dialog.Description>{item ? `${item.artist} — ${item.title}` : 'Choose an export mode.'}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close"><X size={18} /></Dialog.Close></div>
    <div className="mpc-mode-list">{options.map(([value, title, description]) => <label key={value} className={mode === value ? 'active' : ''}><input type="radio" name="mpc-mode" value={value} checked={mode === value} onChange={() => onMode(value)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</div>
    <div className="mpc-dialog__footer"><button className="text-button" type="button" onClick={onSettings}>Destination settings</button><Dialog.Close className="button button--outline">Cancel</Dialog.Close><button className="button button--primary" disabled={busy || !item} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="spin" /> : <Cpu size={14} />} Queue export</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}

function QueueFormatDialog({ item, stems, format, open, busy, onFormat, onOpenChange, onConfirm }: {
  item: Suggestion | null; stems: boolean; format: OutputFormat; open: boolean; busy: boolean
  onFormat: (format: OutputFormat) => void; onOpenChange: (open: boolean) => void; onConfirm: () => void
}) {
  const options: Array<[OutputFormat, string, string]> = [
    ['m4a', 'M4A', 'Fastest · native YouTube audio'],
    ['mp3', 'MP3', '320 kbps · universal'],
    ['wav', 'WAV', '44.1 kHz · 16-bit PCM'],
  ]
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="mpc-dialog queue-format-dialog">
    <div className="panel-heading"><div><span className="eyebrow">VAULT INGESTION</span><Dialog.Title>{stems ? 'Queue track + stems' : 'Queue track'}</Dialog.Title><Dialog.Description>{item ? `${item.artist} — ${item.title}` : 'Choose the Vault audio format.'}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close"><X size={18} /></Dialog.Close></div>
    <fieldset className="format-picker"><legend>Vault audio format</legend>{options.map(([value, label, note]) => <label key={value} className={format === value ? 'active' : ''}><input type="radio" name="crate-output-format" value={value} checked={format === value} onChange={() => onFormat(value)} /><FileAudio size={17} /><span><strong>{label}</strong><small>{note}</small></span></label>)}</fieldset>
    {stems && <div className="queue-format-dialog__stems"><WandSparkles size={15} /><span><strong>Stem separation included</strong><small>Demucs will run after the selected Vault file is safely ingested.</small></span></div>}
    <div className="mpc-dialog__footer"><Dialog.Close className="button button--outline">Cancel</Dialog.Close><button className="button button--primary" disabled={busy || !item} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} Queue as {format.toUpperCase()}{stems ? ' + stems' : ''}</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}

function SuggestionCard({ item, index, previewState, active, preparing, queueing, actions, onPlay, onQueue }: {
  item: Suggestion; index: number; previewState?: PreviewPrefetchItem; active: boolean; preparing: boolean; queueing: boolean
  actions: Omit<ActionMenuProps, 'item' | 'queueing'>
  onPlay: (item: Suggestion, mode?: 'quick' | 'full') => void; onQueue: (item: Suggestion, stems?: boolean) => void
}) {
  const playable = !!item.youtube_video_id
  return <article className={`dig-card ${active ? 'dig-card--active' : ''}`}>
    <RecordArtwork item={item} index={index} playing={active && !preparing} />
    <div className="dig-card__copy">
      <span className="artist">{item.artist}</span><h3>{item.title}</h3>
      <div className="metadata"><span>{item.year || '—'}</span><b>•</b><span>{item.country || 'Unknown'}</span><b>•</b><span>{item.style || item.genre || 'Other'}</span>{typeof item.match_score === 'number' && <><b>•</b><span>match {Math.round(item.match_score * 100)}%</span></>}</div>
      <SampleReasons item={item} />
      <div className={`ready-label ready-label--${previewState?.state || 'pending'}`}>{previewState?.error_message || previewState?.message || (item.demo ? 'Demo reel' : 'Queued for preview')}</div>
      {actions.mpcJob && <div className={`mpc-inline mpc-inline--${actions.mpcJob.state}`}>{actions.mpcJob.error_message || actions.mpcJob.message || mpcLabel(actions.mpcJob)}</div>}
      <div className="dig-card__actions">
        <button className="button button--outline" aria-label={`Play ${item.artist} — ${item.title}`} disabled={!playable || preparing} onClick={() => onPlay(item)}>{preparing && active ? <LoaderCircle size={14} className="spin" /> : <Play size={14} fill="currentColor" />} {previewLabel(previewState, active, preparing)}</button>
        <button className="button button--outline" aria-label={`Load full track ${item.artist} — ${item.title}`} disabled={!playable || (active && preparing)} onClick={() => onPlay(item, 'full')}><Waves size={14} /> Full track</button>
        <button className="button button--primary" disabled={!item.youtube_url || queueing} onClick={() => onQueue(item)}><Plus size={15} /> {queueing ? 'Queueing…' : 'Queue'}</button>
        <SongActionMenu item={item} queueing={queueing} {...actions} />
      </div>
      {item.discogs_url && <button className="discogs-credit" onClick={() => openExternal(item.discogs_url!)}>Data provided by Discogs</button>}
    </div>
  </article>
}

function PlayedCard({ item, index, playedNumber, queueing, actions, onPlay, onQueue }: {
  item: Suggestion; index: number; playedNumber: number; queueing: boolean
  actions: Omit<ActionMenuProps, 'item' | 'queueing'>
  onPlay: (item: Suggestion) => void; onQueue: (item: Suggestion, stems?: boolean) => void
}) {
  return <article className="played-card">
    <RecordArtwork item={item} index={index} />
    <div className="played-card__copy"><span>PLAYED {String(playedNumber).padStart(2, '0')}</span><strong>{item.title}</strong><small>{item.artist}</small></div>
    <div className="played-card__actions">
      <button className="button button--outline" aria-label={`Replay ${item.artist} — ${item.title}`} disabled={!item.youtube_video_id} onClick={() => onPlay(item)}><RotateCcw size={13} /> Replay</button>
      <button className="button button--primary" disabled={!item.youtube_url || queueing} onClick={() => onQueue(item)}><Plus size={13} /> {queueing ? 'Queueing…' : 'Queue'}</button>
      <SongActionMenu item={item} queueing={queueing} {...actions} />
    </div>
  </article>
}

export function DigitalCrate() {
  const crate = useDigitalCrateStore()
  const handledRun = useRef(0)
  const navigate = useNavigate()
  const toast = useToastStore((state) => state.show)
  const queryClient = useQueryClient()
  const player = usePlayerStore()
  const heroRef = useRef<HTMLElement>(null)
  const previousTrackId = useRef<string | null>(player.track?.id || null)
  const [mpcItem, setMpcItem] = useState<Suggestion | null>(null)
  const [mpcMode, setMpcMode] = useState<MpcExportMode>('both')
  const [queueIntent, setQueueIntent] = useState<{ item: Suggestion; stems: boolean } | null>(null)
  const [queueFormat, setQueueFormat] = useState<OutputFormat>('m4a')
  const filters = useMemo(() => ({
    profile: crate.profile, year_min: eras[crate.era][1], year_max: eras[crate.era][2],
    country: crate.country || undefined, genre: crate.genre || undefined,
    min_have: 5, max_have: 2500, prioritize_samples: true, sample_intensity: 0.9,
    allow_compilations: false, count: 8,
  }), [crate.profile, crate.era, crate.country, crate.genre])
  const config = useQuery({ queryKey: ['config'], queryFn: api.config })
  const dig = useQuery({
    queryKey: ['digital-crate-dig', crate.digRun], queryFn: () => api.dig(filters),
    enabled: crate.digRun > crate.appliedRun, retry: false, staleTime: Infinity,
    gcTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false,
  })
  const enqueue = useMutation({
    mutationFn: ({ item, stems, format }: { item: Suggestion; stems: boolean; format: OutputFormat }) => api.enqueue({
      source_url: item.youtube_url, display_name: `${item.artist} — ${item.title}`, origin: 'digital_crate',
      output_format: format, enable_stems: stems, hint_genre: item.genre, hint_country: item.country,
      hint_year: item.year, hint_discogs_master_id: item.discogs_master_id > 0 ? item.discogs_master_id : undefined,
      hint_discogs_release_id: item.discogs_release_id, source_platform_override: 'discogs_dig',
    }),
    onSuccess: (_, { item }) => {
      if (item.youtube_video_id) crate.lockSource(item.discogs_master_id, item.youtube_video_id)
      api.recordDiscoveryInteraction(item, 'queue').catch(() => undefined)
      setQueueIntent(null)
      toast('Track added to the ingestion queue', 'success')
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (error) => toast(error.message, 'error'),
  })
  const rematch = useMutation({
    mutationFn: async (item: Suggestion) => {
      if (!item.youtube_video_id) throw new Error('This result has no audio source to replace.')
      crate.rejectSource(item.discogs_master_id, item.youtube_video_id)
      crate.setRematching(item.discogs_master_id, true)
      const rejected = Array.from(new Set([...(crate.rejectedSources[item.discogs_master_id] || []), item.youtube_video_id]))
      return { previous: item, replacement: await api.rematch(item, rejected) }
    },
    onSuccess: ({ previous, replacement }) => {
      if (player.track?.videoId === previous.youtube_video_id) player.clear()
      crate.replaceSource(previous.discogs_master_id, replacement)
      player.replaceReelSource(previous.discogs_master_id, replacement)
      crate.setRematching(previous.discogs_master_id, false)
      if (replacement.youtube_video_id) {
        api.prefetchPreviews([replacement.youtube_video_id]).then((result) => crate.setPreviewItems(result.items)).catch(() => undefined)
      }
      toast(`Selected another source: ${replacement.youtube_title || replacement.title}`, 'success')
    },
    onError: (error, item) => {
      crate.setRematching(item.discogs_master_id, false)
      toast(error.message)
    },
  })
  const mpc = useMutation({
    mutationFn: ({ item, mode }: { item: Suggestion; mode: MpcExportMode }) => api.enqueueMpc(item, mode),
    onSuccess: (job, { item }) => {
      crate.updateMpcJob(job)
      if (item.youtube_video_id) crate.lockSource(item.discogs_master_id, item.youtube_video_id)
      api.recordDiscoveryInteraction(item, 'mpc').catch(() => undefined)
      setMpcItem(null)
      toast(`MPC export queued: ${item.artist} — ${item.title}`, 'success')
    },
    onError: (error) => toast(`${error.message}. Check the MPC destination in Settings.`, 'error'),
  })
  const cancelMpc = useMutation({
    mutationFn: (job: MpcJob) => api.cancelMpc(job.job_id),
    onSuccess: () => toast('MPC export cancellation requested', 'success'),
    onError: (error) => toast(error.message, 'error'),
  })

  useEffect(() => {
    if (!dig.data || crate.digRun === crate.appliedRun || handledRun.current === crate.digRun) return
    handledRun.current = crate.digRun
    crate.applyReel(crate.digRun, dig.data)
    const ids = dig.data.items.map((item) => item.youtube_video_id).filter((value): value is string => !!value)
    if (ids.length) api.prefetchPreviews(ids).then((result) => crate.setPreviewItems(result.items)).catch((error) => toast(error.message, 'error'))
  }, [dig.data, crate.digRun, crate.appliedRun])

  const startDig = () => config.data?.has_discogs_token ? crate.requestDig() : navigate('/settings')
  const activeSuggestion = crate.items.find((item) => item.youtube_video_id && `preview-${item.youtube_video_id}` === player.track?.id)
  const playedSet = new Set(crate.playedVideoIds)
  const firstUnplayed = crate.items.find((item) => !item.youtube_video_id || !playedSet.has(item.youtube_video_id))
  const featured = activeSuggestion || firstUnplayed || crate.items[0]
  const featuredIndex = featured ? crate.items.indexOf(featured) : 0
  const activePlaying = !!activeSuggestion && player.playing && !player.preparing
  const upNext = crate.items.filter((item) => item !== featured && (!item.youtube_video_id || !playedSet.has(item.youtube_video_id)))
  const playedInReel = crate.playedVideoIds.map((videoId) => crate.items.find((item) => item.youtube_video_id === videoId)).filter((item): item is Suggestion => !!item)
  const playedShelf = playedInReel.filter((item) => item !== activeSuggestion)
  const playableItems = crate.items.filter((item) => !!item.youtube_video_id)
  const allPlayablePlayed = playableItems.length > 0 && playableItems.every((item) => playedSet.has(item.youtube_video_id!))
  const canonicalIndex = activeSuggestion ? player.playlist.findIndex((item) => item.id === player.track?.id) : -1
  const canonicalPosition = canonicalIndex >= 0 ? `${canonicalIndex + 1} OF ${player.playlist.length}` : null
  const digging = dig.isFetching
  const needsDiscogs = config.isSuccess && !config.data.has_discogs_token
  const play = (item: Suggestion, mode: 'quick' | 'full' = 'quick') => {
    if (!item.youtube_video_id) return
    player.playReel(crate.items, `preview-${item.youtube_video_id}`, mode)
  }
  const queue = (item: Suggestion, stems = false) => {
    setQueueFormat('m4a')
    setQueueIntent({ item, stems })
  }
  const openMpc = (item: Suggestion) => {
    setMpcMode(crate.mpcJobs[item.youtube_video_id || '']?.mode || 'both')
    setMpcItem(item)
  }
  const songActions = (item: Suggestion): Omit<ActionMenuProps, 'item' | 'queueing'> => ({
    rematching: !!crate.rematching[item.discogs_master_id],
    locked: crate.lockedSources[item.discogs_master_id] === item.youtube_video_id,
    mpcJob: item.youtube_video_id ? crate.mpcJobs[item.youtube_video_id] : undefined,
    onQueue: queue,
    onRematch: (value) => rematch.mutate(value),
    onMpc: openMpc,
    onCancelMpc: (job) => cancelMpc.mutate(job),
  })
  const bars = activePlaying ? player.spectrum : Array.from({ length: 48 }, (_, index) => 0.12 + ((index * 17) % 42) / 100)

  useEffect(() => {
    const currentTrackId = player.track?.id || null
    const changed = currentTrackId !== previousTrackId.current
    previousTrackId.current = currentTrackId
    if (!changed || !activeSuggestion || !heroRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      heroRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [player.track?.id, activeSuggestion])

  return <div className="page digital-crate">
    <section className="crate-toolbar"><div className="filter-cluster">
      <label>Producer lens<select value={crate.profile} onChange={(event) => crate.setProfile(event.target.value as typeof crate.profile)}>{profiles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Era<select value={crate.era} onChange={(event) => crate.setEra(Number(event.target.value))}>{eras.map(([label], index) => <option key={label} value={index}>{label}</option>)}</select></label>
      <label>Country<select value={crate.country} onChange={(event) => crate.setCountry(event.target.value)}><option value="">World roulette</option>{countries.slice(1).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Genre override<select value={crate.genre} onChange={(event) => crate.setGenre(event.target.value)}><option value="">Let the lens choose</option><option>Funk / Soul</option><option>Jazz</option><option>Latin</option><option>Stage & Screen</option><option>Reggae</option><option>Folk, World, & Country</option><option>Rock</option><option>Electronic</option></select></label>
      <button className="button button--primary dig-button" onClick={startDig} disabled={config.isPending || config.isError || digging}><RefreshCw size={16} className={digging ? 'spin' : ''} /> {digging ? 'Digging…' : needsDiscogs ? 'Add Discogs token' : 'Dig for gems'}</button>
    </div><div className="view-switch"><SlidersHorizontal size={16} /><button className={crate.view === 'list' ? 'active' : ''} onClick={() => crate.setView('list')}><List size={18} /></button><button className={crate.view === 'grid' ? 'active' : ''} onClick={() => crate.setView('grid')}><Grid2X2 size={18} /></button></div></section>

    {config.isError && <div className="error-state"><Disc3 size={18} /><span>The local engine did not return its settings.</span><button className="button button--outline" onClick={() => config.refetch()}>Reconnect</button></div>}
    {needsDiscogs && <div className="notice notice--action"><Disc3 size={18} /><span>This independent profile needs its own Discogs token before it can dig live gems.</span><button className="button button--outline" onClick={() => navigate('/settings')}>Open settings</button></div>}
    {dig.isError && <div className="error-state"><Disc3 size={18} /><span>{dig.error.message}</span><button className="button button--outline" onClick={startDig}>Try again</button></div>}
    {crate.message && <div className="notice"><Disc3 size={18} /><span>{crate.message}</span></div>}

    {!crate.items.length ? <section className={`dig-empty ${digging ? 'is-digging' : ''}`}>
      <div className="dig-empty__art"><img src={crateArtwork} alt="A crate filled with records" /><span /></div>
      <div className="dig-empty__copy"><span className="eyebrow">YOUR NEXT SAMPLE STARTS HERE</span><h2>{digging ? 'Digging through the shelves…' : 'Your crate is empty'}</h2><p>Choose a producer lens, era, country, or genre above. Nothing starts until you decide to dig.</p><button className="button button--primary button--large" onClick={startDig} disabled={digging || config.isPending}>{digging ? <LoaderCircle size={16} className="spin" /> : <Disc3 size={16} />}{needsDiscogs ? 'Add Discogs token' : digging ? 'Finding gems…' : 'Dig for gems'}</button></div>
    </section> : <>
      <section ref={heroRef} className={`featured-dig ${activePlaying ? 'is-playing' : ''}`}>
        <button className="featured-dig__signal" disabled={!featured || player.preparing} onClick={() => featured && play(featured)} aria-label={`Preview ${featured!.artist} — ${featured!.title}`}>{player.preparing && activeSuggestion === featured ? <LoaderCircle size={25} className="spin" /> : <Play size={28} fill="currentColor" />}</button>
        <div className="featured-dig__copy"><span aria-live="polite">{activeSuggestion ? `NOW PLAYING${canonicalPosition ? ` · ${canonicalPosition}` : ''}` : `TOP PULL · ${profiles.find(([value]) => value === crate.profile)?.[1]}`}</span>
          <h2>{featured!.title}</h2><strong>{featured!.artist}</strong><SampleReasons item={featured!} />
          <div className="hero-wave" aria-hidden="true">{bars.map((value, index) => <i key={index} style={{ transform: `scaleY(${Math.max(.08, value)})` }} />)}</div>
          <div className="featured-dig__actions"><button className="button button--primary" disabled={!featured!.youtube_video_id || player.preparing} onClick={() => play(featured!)}><Play size={14} /> {activeSuggestion === featured && player.playing ? 'Playing' : 'Preview'}</button><button className="button button--dark" disabled={!featured!.youtube_video_id || player.preparing} onClick={() => play(featured!, 'full')}><Waves size={14} /> Full track</button><button className="button button--dark" disabled={!featured!.youtube_url} onClick={() => queue(featured!)}><Plus size={14} /> Queue</button><SongActionMenu item={featured!} queueing={enqueue.isPending && enqueue.variables?.item === featured} {...songActions(featured!)} /></div>
        </div><RecordArtwork item={featured} index={featuredIndex} featured playing={activePlaying} />
      </section>
      <section className="crate-lane" aria-labelledby="up-next-heading"><div className="crate-lane__heading"><div><span className="eyebrow">KEEP DIGGING</span><h3 id="up-next-heading">Up next</h3></div><strong>{upNext.length}</strong></div>
      {allPlayablePlayed && <div className="crate-complete"><Check size={18} /><div><strong>Crate auditioned</strong><span>You listened through this pull. Replay a gem below or dig a fresh crate.</span></div></div>}
      <div className={`dig-results dig-results--${crate.view}`}>{upNext.map((item) => {
        const id = `preview-${item.youtube_video_id}`
        return <SuggestionCard key={item.discogs_master_id} item={item} index={crate.items.indexOf(item)} previewState={item.youtube_video_id ? crate.previewStates[item.youtube_video_id] : undefined} active={player.track?.id === id} preparing={player.track?.id === id && player.preparing} queueing={enqueue.isPending && enqueue.variables?.item === item} actions={songActions(item)} onPlay={play} onQueue={queue} />
      })}</div></section>
      {!!playedInReel.length && <section className="played-section" aria-labelledby="played-heading"><div className="crate-lane__heading crate-lane__heading--played"><div><span className="eyebrow"><Headphones size={12} /> SESSION MEMORY</span><h3 id="played-heading">Played this session</h3></div><strong>{playedInReel.length}</strong></div><div className="played-list">{playedShelf.map((item) => <PlayedCard key={item.youtube_video_id} item={item} index={crate.items.indexOf(item)} playedNumber={crate.playedVideoIds.indexOf(item.youtube_video_id!) + 1} queueing={enqueue.isPending && enqueue.variables?.item === item} actions={songActions(item)} onPlay={play} onQueue={queue} />)}</div>{!playedShelf.length && activeSuggestion && <div className="played-active-note">The first listened record is currently featured above.</div>}</section>}
    </>}
    <QueueFormatDialog item={queueIntent?.item || null} stems={queueIntent?.stems || false} format={queueFormat} open={!!queueIntent} busy={enqueue.isPending} onFormat={setQueueFormat} onOpenChange={(open) => !open && !enqueue.isPending && setQueueIntent(null)} onConfirm={() => queueIntent && enqueue.mutate({ ...queueIntent, format: queueFormat })} />
    <MpcModeDialog item={mpcItem} mode={mpcMode} open={!!mpcItem} busy={mpc.isPending} onMode={setMpcMode} onOpenChange={(open) => !open && setMpcItem(null)} onConfirm={() => mpcItem && mpc.mutate({ item: mpcItem, mode: mpcMode })} onSettings={() => { setMpcItem(null); navigate('/settings') }} />
  </div>
}
