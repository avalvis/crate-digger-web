import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DropdownMenu } from 'radix-ui'
import { Link } from 'react-router-dom'
import { Disc3, ExternalLink, Grid2X2, List, MoreVertical, Play, Plus, RefreshCw, SlidersHorizontal, WandSparkles } from 'lucide-react'
import { api, mediaUrl } from '../lib/api'
import type { Suggestion } from '../lib/types'
import { usePlayerStore } from '../store/player'
import { useToastStore } from '../store/toast'

const eras = [
  ['All eras', undefined, undefined],
  ['60s–70s Soul', 1960, 1979],
  ['70s Jazz/Funk', 1970, 1979],
  ['Greek 60s–80s', 1960, 1989],
  ['Library / OST', 1960, 1989],
] as const

function initials(item: Suggestion) {
  return item.artist.split(/\s+/).slice(0, 2).map((word) => word[0]).join('')
}

function artClass(index: number) { return `record-art record-art--${(index % 4) + 1}` }

function SuggestionCard({ item, index, onPreview, onQueue, busy }: {
  item: Suggestion
  index: number
  onPreview: (item: Suggestion) => void
  onQueue: (item: Suggestion, stems?: boolean) => void
  busy: boolean
}) {
  return (
    <article className="dig-card">
      <div className={artClass(index)}><span>{initials(item)}</span><i /></div>
      <div className="dig-card__copy">
        <span className="artist">{item.artist}</span>
        <h3>{item.title}</h3>
        <div className="metadata">
          <span>{item.year || '—'}</span><b>•</b><span>{item.country || 'Unknown'}</span><b>•</b><span>{item.genre || item.style || 'Other'}</span>
          {typeof item.match_score === 'number' && <><b>•</b><span>YT {Math.round(item.match_score * 100)}%</span></>}
        </div>
        {item.sample_friendly && <div className="sample-label">• sample-friendly</div>}
        <div className="ready-label">{item.demo ? 'Demo reel' : 'Ready'}</div>
        <span className="preview-note">{item.demo ? 'Connect Discogs to load a playable match' : 'Press Preview to load waveform'}</span>
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
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </article>
  )
}

export function DigitalCrate() {
  const [era, setEra] = useState(0)
  const [genre, setGenre] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const setPlayer = usePlayerStore((state) => state.setTrack)
  const toast = useToastStore((state) => state.show)
  const queryClient = useQueryClient()
  const filters = useMemo(() => ({
    year_min: eras[era][1], year_max: eras[era][2], genre: genre || undefined,
    min_have: 10, max_have: 3000, prioritize_samples: true, sample_intensity: 0.6,
    allow_compilations: false, count: 8,
  }), [era, genre])
  const dig = useMutation({
    mutationFn: () => api.dig(filters),
    onError: (error) => toast(error.message, 'error'),
  })
  const enqueue = useMutation({
    mutationFn: ({ item, stems }: { item: Suggestion; stems: boolean }) => api.enqueue({
      source_url: item.youtube_url,
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

  useEffect(() => { dig.mutate() }, [])
  const items = dig.data?.items || []
  const busy = enqueue.isPending || preview.isPending

  return (
    <div className="page digital-crate">
      <section className="crate-toolbar">
        <div className="filter-cluster">
          <label>Era<select value={era} onChange={(event) => setEra(Number(event.target.value))}>{eras.map(([label], index) => <option key={label} value={index}>{label}</option>)}</select></label>
          <label>Genre<select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="">Any genre</option><option>Funk / Soul</option><option>Jazz</option><option>Electronic</option><option>Rock</option></select></label>
          <button className="button button--primary dig-button" onClick={() => dig.mutate()} disabled={dig.isPending}><RefreshCw size={16} className={dig.isPending ? 'spin' : ''} /> {dig.isPending ? 'Digging…' : 'Dig the crate'}</button>
        </div>
        <div className="view-switch"><SlidersHorizontal size={16} /><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={18} /></button><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><Grid2X2 size={18} /></button></div>
      </section>

      {dig.data?.message && <div className="notice"><Disc3 size={18} /><span>{dig.data.message}</span><Link to="/settings">Open Settings</Link></div>}

      <section className="featured-dig">
        <div className="featured-dig__signal"><Play size={28} fill="currentColor" /></div>
        <div className="featured-dig__copy">
          <span>NOW DIGGING</span>
          <h2>{items[0]?.title || 'Waiting for the next pull'}</h2>
          <strong>{items[0]?.artist || 'Crate Digger'}</strong>
          <div className="hero-wave" aria-hidden="true">{Array.from({ length: 72 }).map((_, index) => <i key={index} style={{ height: `${12 + ((index * 19) % 45)}%` }} />)}</div>
        </div>
        <div className={`${artClass(0)} featured-dig__art`}><span>{items[0] ? initials(items[0]) : 'CD'}</span><i /></div>
      </section>

      <div className={`dig-results dig-results--${view}`}>
        {items.slice(1).map((item, index) => (
          <SuggestionCard key={item.discogs_master_id} item={item} index={index + 1} busy={busy} onPreview={(value) => preview.mutate(value)} onQueue={(value, stems = false) => enqueue.mutate({ item: value, stems })} />
        ))}
      </div>
    </div>
  )
}
