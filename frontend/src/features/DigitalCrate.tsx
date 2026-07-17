import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { DropdownMenu } from 'radix-ui'
import { Disc3, Grid2X2, List, LoaderCircle, MoreVertical, Play, Plus, RefreshCw, SlidersHorizontal, Waves, WandSparkles } from 'lucide-react'
import { api } from '../lib/api'
import { openExternal } from '../lib/desktop'
import type { PreviewPrefetchItem, Suggestion } from '../lib/types'
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

function SuggestionCard({ item, index, previewState, active, preparing, queueing, onPlay, onQueue }: {
  item: Suggestion; index: number; previewState?: PreviewPrefetchItem; active: boolean; preparing: boolean; queueing: boolean
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
      <div className="dig-card__actions">
        <button className="button button--outline" disabled={!playable || preparing} onClick={() => onPlay(item)}>{preparing && active ? <LoaderCircle size={14} className="spin" /> : <Play size={14} fill="currentColor" />} {previewLabel(previewState, active, preparing)}</button>
        <button className="button button--outline" disabled={!playable || (active && preparing)} onClick={() => onPlay(item, 'full')}><Waves size={14} /> Full track</button>
        <button className="button button--primary" disabled={!item.youtube_url || queueing} onClick={() => onQueue(item)}><Plus size={15} /> {queueing ? 'Queueing…' : 'Queue'}</button>
        <DropdownMenu.Root><DropdownMenu.Trigger className="icon-button dig-card__more" aria-label="More actions"><MoreVertical size={18} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu-content" sideOffset={7}>
          <DropdownMenu.Item disabled={!item.youtube_url || queueing} onSelect={() => onQueue(item, true)}><WandSparkles size={13} /> Queue + stems</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => navigator.clipboard.writeText(`${item.artist} — ${item.title}`)}>Copy track name</DropdownMenu.Item>
          <DropdownMenu.Item disabled={!item.youtube_url} onSelect={() => item.youtube_url && openExternal(item.youtube_url)}>Open YouTube</DropdownMenu.Item>
          <DropdownMenu.Item disabled={!item.discogs_url} onSelect={() => item.discogs_url && openExternal(item.discogs_url)}>Open Discogs</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
      </div>
      {item.discogs_url && <button className="discogs-credit" onClick={() => openExternal(item.discogs_url!)}>Data provided by Discogs</button>}
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
    mutationFn: ({ item, stems }: { item: Suggestion; stems: boolean }) => api.enqueue({
      source_url: item.youtube_url, display_name: `${item.artist} — ${item.title}`, origin: 'digital_crate',
      output_format: 'm4a', enable_stems: stems, hint_genre: item.genre, hint_country: item.country,
      hint_year: item.year, hint_discogs_master_id: item.discogs_master_id > 0 ? item.discogs_master_id : undefined,
      hint_discogs_release_id: item.discogs_release_id, source_platform_override: 'discogs_dig',
    }),
    onSuccess: () => { toast('Track added to the ingestion queue', 'success'); queryClient.invalidateQueries({ queryKey: ['jobs'] }) },
    onError: (error) => toast(error.message, 'error'),
  })

  useEffect(() => {
    if (config.data?.has_discogs_token && crate.items.length === 0 && crate.digRun === 0) crate.ensureInitialDig()
  }, [config.data?.has_discogs_token, crate.items.length, crate.digRun])
  useEffect(() => {
    if (!dig.data || crate.digRun === crate.appliedRun || handledRun.current === crate.digRun) return
    handledRun.current = crate.digRun
    crate.applyReel(crate.digRun, dig.data)
    const ids = dig.data.items.map((item) => item.youtube_video_id).filter((value): value is string => !!value)
    if (ids.length) api.prefetchPreviews(ids).then((result) => crate.setPreviewItems(result.items)).catch((error) => toast(error.message, 'error'))
  }, [dig.data, crate.digRun, crate.appliedRun])

  const startDig = () => config.data?.has_discogs_token ? crate.requestDig() : navigate('/settings')
  const activeSuggestion = crate.items.find((item) => item.youtube_video_id && `preview-${item.youtube_video_id}` === player.track?.id)
  const featured = activeSuggestion || crate.items[0]
  const featuredIndex = featured ? crate.items.indexOf(featured) : 0
  const activePlaying = !!activeSuggestion && player.playing && !player.preparing
  const remaining = crate.items.filter((item) => item !== featured)
  const digging = dig.isFetching
  const needsDiscogs = config.isSuccess && !config.data.has_discogs_token
  const play = (item: Suggestion, mode: 'quick' | 'full' = 'quick') => {
    if (!item.youtube_video_id) return
    player.playReel(crate.items, `preview-${item.youtube_video_id}`, mode)
  }
  const queue = (item: Suggestion, stems = false) => enqueue.mutate({ item, stems })
  const bars = activePlaying ? player.spectrum : Array.from({ length: 48 }, (_, index) => 0.14 + ((index * 19) % 70) / 100)

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

    <section className={`featured-dig ${activePlaying ? 'is-playing' : ''}`}>
      <button className="featured-dig__signal" disabled={!featured || player.preparing} onClick={() => featured && play(featured)} aria-label="Preview featured gem">{player.preparing && activeSuggestion === featured ? <LoaderCircle size={25} className="spin" /> : <Play size={28} fill="currentColor" />}</button>
      <div className="featured-dig__copy"><span>{activeSuggestion ? 'NOW PLAYING' : `TOP PULL · ${profiles.find(([value]) => value === crate.profile)?.[1]}`}</span>
        <h2>{featured?.title || (digging ? 'Digging across several crates…' : needsDiscogs ? 'Connect Discogs to dig live gems' : 'Waiting for the next pull')}</h2><strong>{featured?.artist || 'Crate Digger'}</strong>
        {featured && <SampleReasons item={featured} />}
        <div className="hero-wave" aria-hidden="true">{bars.map((value, index) => <i key={index} style={{ transform: `scaleY(${Math.max(.08, value)})` }} />)}</div>
        {featured && <div className="featured-dig__actions"><button className="button button--primary" disabled={!featured.youtube_video_id || player.preparing} onClick={() => play(featured)}><Play size={14} /> {activeSuggestion === featured && player.playing ? 'Playing' : 'Preview'}</button><button className="button button--dark" disabled={!featured.youtube_video_id || player.preparing} onClick={() => play(featured, 'full')}><Waves size={14} /> Full track</button><button className="button button--dark" disabled={!featured.youtube_url} onClick={() => queue(featured)}><Plus size={14} /> Queue</button></div>}
      </div><RecordArtwork item={featured} index={featuredIndex} featured playing={activePlaying} />
    </section>
    <div className={`dig-results dig-results--${crate.view}`}>{remaining.map((item) => {
      const id = `preview-${item.youtube_video_id}`
      return <SuggestionCard key={item.discogs_master_id} item={item} index={crate.items.indexOf(item)} previewState={item.youtube_video_id ? crate.previewStates[item.youtube_video_id] : undefined} active={player.track?.id === id} preparing={player.track?.id === id && player.preparing} queueing={enqueue.isPending && enqueue.variables?.item === item} onPlay={play} onQueue={queue} />
    })}</div>
  </div>
}
