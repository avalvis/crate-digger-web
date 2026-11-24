import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from 'radix-ui'
import { Disc3, FileAudio, Heart, History, Play, Plus, X } from 'lucide-react'
import { api } from '../lib/api'
import type { ListeningEntry, ListeningPage, Suggestion } from '../lib/types'
import { useDigitalCrateStore } from '../store/digitalCrate'
import { useToastStore } from '../store/toast'

/** Keep (like) toggle shared by reel cards and the history list. */
export function KeepButton({ item, compact = false }: { item: Suggestion; compact?: boolean }) {
  const videoId = item.youtube_video_id
  const kept = useDigitalCrateStore((state) => !!videoId && state.likedVideoIds.includes(videoId))
  const queryClient = useQueryClient()
  const toast = useToastStore((state) => state.show)
  const save = useMutation({
    mutationFn: (liked: boolean) => api.setLiked(item, liked),
    onMutate: (liked) => { if (videoId) useDigitalCrateStore.getState().setLiked(videoId, liked) },
    onError: (error, liked) => {
      if (videoId) useDigitalCrateStore.getState().setLiked(videoId, !liked)
      toast(error.message, 'error')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['listening'] }),
  })
  if (!videoId) return null
  const label = `${kept ? 'Remove from kept' : 'Keep'} ${item.artist} — ${item.title}`
  return <button type="button" className={`keep-button ${kept ? 'is-kept' : ''} ${compact ? 'keep-button--compact' : ''}`} aria-pressed={kept} aria-label={label} title={kept ? 'Kept' : 'Keep this record'} onClick={() => save.mutate(!kept)}>
    <Heart size={compact ? 14 : 15} fill={kept ? 'currentColor' : 'none'} />{!compact && <span>{kept ? 'Kept' : 'Keep'}</span>}
  </button>
}

function when(value: string | null) {
  if (!value) return ''
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(value).toLocaleDateString()
}

function HistoryRow({ entry, onPlay, onQueue, onMpc }: {
  entry: ListeningEntry; onPlay: () => void; onQueue: () => void; onMpc: () => void
}) {
  const item = entry.suggestion
  const played = entry.play_count > 0
  return <li className="history-row">
    <div className="history-row__art">{item.artwork_url ? <img src={item.artwork_url} alt="" loading="lazy" /> : <Disc3 size={18} />}</div>
    <div className="history-row__copy">
      <strong>{item.title}</strong><span>{item.artist}{item.year ? ` · ${item.year}` : ''}{item.country ? ` · ${item.country}` : ''}</span>
      <small>{played ? `Played ${entry.play_count}× · ${when(entry.last_played_at)}` : `Kept ${when(entry.liked_at)} · not played yet`}</small>
    </div>
    <div className="history-row__actions">
      <KeepButton item={item} compact />
      <button type="button" className="icon-button" aria-label={`Play ${item.artist} — ${item.title}`} onClick={onPlay}><Play size={15} fill="currentColor" /></button>
      <button type="button" className="icon-button" aria-label={`Queue ${item.artist} — ${item.title}`} onClick={onQueue}><Plus size={16} /></button>
      <button type="button" className="icon-button" aria-label={`Export ${item.artist} — ${item.title} to MPC`} onClick={onMpc}><FileAudio size={15} /></button>
    </div>
  </li>
}

/**
 * Everything you auditioned or kept in Digital Crate, across digs and app
 * restarts, so a record you liked is never lost once the reel moves on.
 */
export function ListeningHistory({ open, onOpenChange, onPlay, onQueue, onMpc }: {
  open: boolean; onOpenChange: (open: boolean) => void
  onPlay: (items: Suggestion[], item: Suggestion) => void
  onQueue: (item: Suggestion) => void
  onMpc: (item: Suggestion) => void
}) {
  const [filter, setFilter] = useState<'all' | 'liked'>('all')
  const history = useQuery<ListeningPage>({ queryKey: ['listening', filter], queryFn: () => api.listening(filter), enabled: open })
  const items = history.data?.items || []
  const playable = items.map((entry) => entry.suggestion).filter((item) => !!item.youtube_video_id)
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="queue-panel history-panel">
        <div className="panel-heading"><div><span className="eyebrow"><History size={12} /> LISTENING HISTORY</span><Dialog.Title>Records you heard</Dialog.Title><Dialog.Description>Every Digital Crate record you played or kept, across digs.</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close history"><X size={18} /></Dialog.Close></div>
        <div className="queue-tabs history-tabs" role="tablist">
          <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
          <button role="tab" aria-selected={filter === 'liked'} className={filter === 'liked' ? 'active' : ''} onClick={() => setFilter('liked')}><Heart size={12} /> Kept</button>
          {history.data && <span className="history-count">{history.data.total}</span>}
        </div>
        {history.isLoading && <div className="loading-state"><Disc3 className="spin" /> Loading history…</div>}
        {history.isError && <div className="error-state">{history.error.message}</div>}
        {history.isSuccess && !items.length && <div className="empty-state compact"><h3>{filter === 'liked' ? 'Nothing kept yet' : 'Nothing played yet'}</h3><p>{filter === 'liked' ? 'Tap the heart on a record to keep it here.' : 'Records appear here after a few seconds of listening.'}</p></div>}
        <ul className="history-list">{items.map((entry) => <HistoryRow key={entry.suggestion.youtube_video_id} entry={entry}
          onPlay={() => onPlay(playable, entry.suggestion)} onQueue={() => onQueue(entry.suggestion)} onMpc={() => onMpc(entry.suggestion)} />)}</ul>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
