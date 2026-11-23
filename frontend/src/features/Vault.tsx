import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Archive, Disc3, FolderOpen, Search } from 'lucide-react'
import { useLocation } from 'react-router'
import { api } from '../lib/api'
import { openFolder } from '../lib/desktop'
import { CrateAssignmentDialog } from '../components/CrateAssignmentDialog'
import { TrackInspector, TrackTable } from '../components/TrackLibrary'
import { useToastStore } from '../store/toast'

const PAGE_SIZE = 200

export function Vault({ query }: { query: string }) {
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const openedFromQueue = useRef<number | null>(null)
  const location = useLocation(); const toast = useToastStore((state) => state.show)
  // Paged so large vaults load progressively instead of stopping at one page.
  const tracks = useInfiniteQuery({
    queryKey: ['tracks', 'vault', query, unassignedOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.tracks(query, { unassigned: unassignedOnly || undefined, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return last.items.length && loaded < last.total ? loaded : undefined
    },
  })
  const items = useMemo(() => tracks.data?.pages.flatMap((page) => page.items) ?? [], [tracks.data])
  const total = tracks.data?.pages[0]?.total ?? 0
  const sentinel = useRef<HTMLDivElement | null>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = tracks
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '600px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length])
  const config = useQuery({ queryKey: ['config'], queryFn: api.config })
  const requestedTrackId = (location.state as { trackId?: number } | null)?.trackId
  useEffect(() => { setSelected([]) }, [query, unassignedOnly])
  useEffect(() => {
    if (!requestedTrackId || openedFromQueue.current === requestedTrackId || !tracks.data) return
    openedFromQueue.current = requestedTrackId
    setSelectedTrackId(requestedTrackId)
  }, [requestedTrackId, tracks.data])
  const revealVault = async () => {
    const path = String(config.data?.config.general.vault_root || '')
    if (!path) return
    try { await openFolder(path) } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error') }
  }
  return <div className="page vault-page"><div className="page-heading"><div><span className="eyebrow">LOCAL LIBRARY</span><h2>{total} records in the vault</h2></div><div className="vault-stats"><button className={`vault-filter ${unassignedOnly ? 'active' : ''}`} onClick={() => setUnassignedOnly((value) => !value)}><Archive size={14} /> {unassignedOnly ? 'Showing unassigned' : 'Unassigned only'}</button><button className="vault-folder-button" onClick={revealVault} disabled={!config.data} title="Open Vault folder"><FolderOpen size={16} /> Open folder</button></div></div>
    {!!selected.length && <div className="vault-selection-bar"><span><strong>{selected.length}</strong> selected</span><button className="button button--primary" onClick={() => setAssigning(true)}><Archive size={14} /> Assign to crate</button><button className="text-button" onClick={() => setSelected([])}>Clear</button></div>}
    {tracks.isLoading && <div className="loading-state"><Disc3 className="spin" /> Reading the vault…</div>}{tracks.isError && <div className="error-state">{tracks.error.message}</div>}
    {tracks.isSuccess && items.length === 0 && <div className="empty-state"><div><Search size={30} /></div><h3>{unassignedOnly ? 'Every song has a crate' : query ? 'No matching records' : 'Your vault is waiting'}</h3><p>{unassignedOnly ? 'Turn off the filter to browse the full Vault.' : query ? 'Try a broader artist, title, genre, or tag.' : 'Queue a record from Digital Crate or paste a URL in Manual Rip.'}</p></div>}
    {!!items.length && <TrackTable tracks={items} selected={selected} onSelected={setSelected} onOpen={setSelectedTrackId} />}
    {hasNextPage && <div ref={sentinel} className="vault-more"><button className="button button--outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? 'Loading…' : `Load more (${items.length} of ${total})`}</button></div>}
    <TrackInspector trackId={selectedTrackId} open={selectedTrackId !== null} onOpenChange={(value) => !value && setSelectedTrackId(null)} />
    <CrateAssignmentDialog open={assigning} initialTrackIds={selected} onOpenChange={setAssigning} onComplete={() => setSelected([])} />
  </div>
}
