import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { DropdownMenu } from 'radix-ui'
import { Disc3, ExternalLink, Grid2X2, List, MoreVertical, Play, Plus, RefreshCw, SlidersHorizontal, WandSparkles } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import type { Suggestion } from '../lib/types'
import { usePlayerStore } from '../store/player'
import { useToastStore } from '../store/toast'

const profiles = [
  ['boom_bap', 'Boom-bap gold'],
  ['lofi', 'Lo-fi textures'],
  ['global', 'Global deep cuts'],
  ['cinematic', 'Cinematic / library'],
] as const

const eras = [
  ['All source eras', undefined, undefined],
  ['Golden source · 1960–79', 1960, 1979],
  ['Dusty early · 1945–64', 1945, 1964],
  ['Seventies · 1970–79', 1970, 1979],
  ['Eighties · 1980–89', 1980, 1989],
] as const

const countries = ['', 'Greece', 'Brazil', 'Japan', 'France', 'Italy', 'Turkey', 'Nigeria', 'Ghana', 'Ethiopia', 'Jamaica', 'India']

function initials(item: Suggestion) {
  return item.artist.split(/\s+/).slice(0, 2).map((word) => word[0]).join('')
}

function artClass(index: number) { return `record-art record-art--${(index % 4) + 1}` }

function RecordArtwork({ item, index, featured = false }: { item?: Suggestion; index: number; featured?: boolean }) {
  return (
    <div className={`${artClass(index)} ${featured ? 'featured-dig__art' : ''}`}>
      {item?.artwork_url
        ? <img src={item.artwork_url} alt={`${item.artist} — ${item.title} cover`} loading="lazy" />
        : <><span>{item ? initials(item) : 'CD'}</span><i /></>}
    </div>
  )
}

function SampleReasons({ item }: { item: Suggestion }) {
  const reasons = item.sample_reasons || []
  if (!reasons.length) return <div className="sample-label">• producer-ranked source</div>
  return <div className="sample-reasons">{reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
}

function SuggestionCard({ item, index, onPreview, onQueue, busy }: {
  item: Suggestion
  index: number
  onPreview: (item: Suggestion) => void
  onQueue: (item: Suggestion, stems?: boolean) => void
  busy: boolean
}) {
  return (
    <article className="dig-card">
      <RecordArtwork item={item} index={index} />
      <div className="dig-card__copy">
        <span className="artist">{item.artist}</span>
        <h3>{item.title}</h3>
        <div className="metadata">
          <span>{item.year || '—'}</span><b>•</b><span>{item.country || 'Unknown'}</span><b>•</b>
          <span>{item.style || item.genre || 'Other'}</span>
          {typeof item.match_score === 'number' && <><b>•</b><span>match {Math.round(item.match_score * 100)}%</span></>}
        </div>
        <SampleReasons item={item} />
        <div className="ready-label">{item.demo ? 'Demo reel' : 'Ready to audition'}</div>
        <span className="preview-note">{item.demo ? 'Add a Discogs token in Settings for live playable gems' : 'Preview before committing it to your vault'}</span>
        <div className="dig-card__actions">
          <button className="button button--outline" disabled={!item.youtube_video_id || busy} onClick={() => onPreview(item)}><Play size={14} fill="currentColor" /> Preview</button>
          <button className="button button--primary" disabled={!item.youtube_url || busy} onClick={() => onQueue(item)}><Plus size={15} /> Queue it</button>
          <button className="button button--outline" disabled={!item.youtube_url || busy} onClick={() => onQueue(item, true)}><WandSparkles size={14} /> MPC workflow</button>
          {item.youtube_url && <a className="text-action" href={item.youtube_url} target="_blank" rel="noreferrer">YouTube <ExternalLink size={12} /></a>}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="icon-button dig-card__more" aria-label="More actions"><MoreVertical size={18} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" sideOffset={7}>
                <DropdownMenu.Item onSelect={() => navigator.clipboard.writeText(`${item.artist} — ${item.title}`)}>Copy track name</DropdownMenu.Item>
                <DropdownMenu.Item disabled={!item.youtube_url} onSelect={() => item.youtube_url && window.open(item.youtube_url, '_blank')}>Open YouTube</DropdownMenu.Item>
                <DropdownMenu.Item disabled={!item.discogs_url} onSelect={() => item.discogs_url && window.open(item.discogs_url, '_blank')}>Open Discogs</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {item.discogs_url && <a className="discogs-credit" href={item.discogs_url} target="_blank" rel="noreferrer">Data provided by Discogs</a>}
      </div>
    </article>
  )
}

export function DigitalCrate() {
  const [profile, setProfile] = useState<(typeof profiles)[number][0]>('boom_bap')
  const [era, setEra] = useState(0)
  const [country, setCountry] = useState('')
  const [genre, setGenre] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [digRun, setDigRun] = useState(0)
  const navigate = useNavigate()
  const setPlayer = usePlayerStore((state) => state.setTrack)
  const toast = useToastStore((state) => state.show)
  const queryClient = useQueryClient()
  const filters = useMemo(() => ({
    profile,
    year_min: eras[era][1], year_max: eras[era][2],
    country: country || undefined,
    genre: genre || undefined,
    min_have: 5, max_have: 2500,
    prioritize_samples: true, sample_intensity: 0.9,
    allow_compilations: false, count: 8,
  }), [profile, era, country, genre])

  const config = useQuery({ queryKey: ['config'], queryFn: api.config })
  const dig = useQuery({
    queryKey: ['digital-crate-dig', digRun],
    queryFn: () => api.dig(filters),
    enabled: digRun > 0,
    retry: false,
    staleTime: Infinity,
  })
  const enqueue = useMutation({
    mutationFn: ({ item, stems }: { item: Suggestion; stems: boolean }) => api.enqueue({
      source_url: item.youtube_url,
      display_name: `${item.artist} — ${item.title}`,
      origin: 'digital_crate',
      enable_stems: stems,
      hint_genre: item.genre,
      hint_country: item.country,
      hint_year: item.year,
      hint_discogs_master_id: item.discogs_master_id > 0 ? item.discogs_master_id : undefined,
      hint_discogs_release_id: item.discogs_release_id,
      source_platform_override: 'discogs_dig',
    }),
    onSuccess: () => { toast('Track added to the ingestion queue', 'success'); queryClient.invalidateQueries({ queryKey: ['jobs'] }) },
    onError: (error) => toast(error.message, 'error'),
  })
  const preview = useMutation({
    mutationFn: async (item: Suggestion) => {
      const prepared = await api.preview(item.youtube_video_id!)
      return { item, prepared, audioUrl: await mediaUrl(prepared.audio_url) }
    },
    onSuccess: ({ item, prepared, audioUrl }) => setPlayer({
      id: `preview-${item.youtube_video_id}`,
      title: item.title,
      artist: item.artist,
      subtitle: 'Digital Crate preview',
      audioUrl,
      peaks: prepared.peaks,
    }),
    onError: (error) => toast(error.message, 'error'),
  })

  // A query owns the initial request lifecycle. This is intentionally not a
  // mutation fired from a mount effect: React Strict Mode can remount effects
  // during development and leave that mutation observer looking permanently
  // pending even though the API already returned successfully.
  useEffect(() => {
    if (config.data?.has_discogs_token) setDigRun((current) => current || 1)
  }, [config.data?.has_discogs_token])

  const startDig = () => {
    if (!config.data?.has_discogs_token) {
      navigate('/settings')
      return
    }
    setDigRun((current) => current + 1)
  }
  const items = dig.data?.items || []
  const featured = items[0]
  const digging = dig.isFetching
  const needsDiscogs = config.isSuccess && !config.data.has_discogs_token
  const busy = enqueue.isPending || preview.isPending
  const queue = (item: Suggestion, stems = false) => enqueue.mutate({ item, stems })

  return (
    <div className="page digital-crate">
      <section className="crate-toolbar">
        <div className="filter-cluster">
          <label>Producer lens<select value={profile} onChange={(event) => setProfile(event.target.value as typeof profile)}>{profiles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Era<select value={era} onChange={(event) => setEra(Number(event.target.value))}>{eras.map(([label], index) => <option key={label} value={index}>{label}</option>)}</select></label>
          <label>Country<select value={country} onChange={(event) => setCountry(event.target.value)}><option value="">World roulette</option>{countries.slice(1).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Genre override<select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="">Let the lens choose</option><option>Funk / Soul</option><option>Jazz</option><option>Latin</option><option>Stage & Screen</option><option>Reggae</option><option>Folk, World, & Country</option><option>Rock</option><option>Electronic</option></select></label>
          <button className="button button--primary dig-button" onClick={startDig} disabled={config.isPending || config.isError || digging}><RefreshCw size={16} className={digging ? 'spin' : ''} /> {digging ? 'Digging several crates…' : needsDiscogs ? 'Add Discogs token' : 'Dig for gems'}</button>
        </div>
        <div className="view-switch"><SlidersHorizontal size={16} /><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={18} /></button><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><Grid2X2 size={18} /></button></div>
      </section>

      {config.isError && <div className="error-state"><Disc3 size={18} /><span>The local engine did not return its settings.</span><button className="button button--outline" onClick={() => config.refetch()}>Reconnect</button></div>}
      {needsDiscogs && <div className="notice notice--action"><Disc3 size={18} /><span>This professional profile is clean and independent, so it needs its own Discogs token before it can dig live sampling gems.</span><button className="button button--outline" onClick={() => navigate('/settings')}>Open settings</button></div>}
      {dig.isError && <div className="error-state"><Disc3 size={18} /><span>{dig.error.message}</span><button className="button button--outline" onClick={startDig}>Try again</button></div>}
      {dig.data?.message && <div className="notice"><Disc3 size={18} /><span>{dig.data.message}</span></div>}

      <section className="featured-dig">
        <button className="featured-dig__signal" disabled={!featured || busy} onClick={() => featured && preview.mutate(featured)} aria-label="Preview featured gem"><Play size={28} fill="currentColor" /></button>
        <div className="featured-dig__copy">
          <span>TOP PULL · {profiles.find(([value]) => value === profile)?.[1]}</span>
          <h2>{featured?.title || (digging ? 'Digging across several crates…' : needsDiscogs ? 'Connect Discogs to dig live gems' : config.isPending ? 'Starting the local engine…' : 'Waiting for the next pull')}</h2>
          <strong>{featured?.artist || (needsDiscogs ? 'One-time setup required' : 'Crate Digger')}</strong>
          {featured && <SampleReasons item={featured} />}
          <div className="hero-wave" aria-hidden="true">{Array.from({ length: 72 }).map((_, index) => <i key={index} style={{ height: `${12 + ((index * 19) % 45)}%` }} />)}</div>
          {featured && <div className="featured-dig__actions"><button className="button button--primary" disabled={busy} onClick={() => preview.mutate(featured)}><Play size={14} /> Preview</button><button className="button button--dark" disabled={busy} onClick={() => queue(featured)}><Plus size={14} /> Queue it</button>{featured.discogs_url && <a href={featured.discogs_url} target="_blank" rel="noreferrer">Data provided by Discogs</a>}</div>}
        </div>
        <RecordArtwork item={featured} index={0} featured />
      </section>

      <div className={`dig-results dig-results--${view}`}>
        {items.slice(1).map((item, index) => (
          <SuggestionCard key={item.discogs_master_id} item={item} index={index + 1} busy={busy} onPreview={(value) => preview.mutate(value)} onQueue={queue} />
        ))}
      </div>
    </div>
  )
}
