export interface Track {
  id: number
  artist: string
  title: string
  album: string | null
  genre: string | null
  style: string | null
  country: string | null
  year: number | null
  duration_seconds: number | null
  bpm: number | null
  musical_key: string | null
  camelot_key: string | null
  stems_separated: boolean
  source_url: string
  source_platform: string
  date_added: string | null
  rating: number | null
  notes: string | null
  tags: string[]
  file_available: boolean
}

export interface TrackPage { items: Track[]; total: number; limit: number; offset: number }

export interface QueueJob {
  id: number
  source_url: string
  display_name: string | null
  status: string
  progress_pct: number
  current_stage: string | null
  error_message: string | null
  track_id: number | null
  enable_stems: boolean
  created_at: string | null
  started_at: string | null
  completed_at: string | null
}

export interface Suggestion {
  discogs_master_id: number
  discogs_release_id: number | null
  artist: string
  title: string
  year: number | null
  country: string | null
  genre: string | null
  style: string | null
  youtube_url: string | null
  youtube_video_id: string | null
  youtube_title: string | null
  youtube_duration_seconds: number | null
  match_score: number | null
  sample_score: number
  sample_reasons: string[]
  artwork_url: string | null
  discogs_url: string | null
  sample_friendly: boolean
  demo: boolean
}

export interface DiscoveryResponse { items: Suggestion[]; demo: boolean; message: string | null }
export interface Crate { id: number; name: string; description: string | null; created_at: string | null; track_count: number }

export interface ConfigResponse {
  config: {
    general: Record<string, unknown>
    downloader: Record<string, unknown>
    stems: Record<string, unknown>
    discovery: Record<string, unknown>
    export: Record<string, unknown>
    ui: Record<string, unknown>
  }
  has_discogs_token: boolean
  has_deepseek_key: boolean
  keyring_available: boolean
  engine_ready: boolean
  engine_error: string | null
}

export interface PreviewResponse {
  video_id: string
  audio_url: string
  peaks: number[]
  duration_seconds: number
  partial: boolean
}

export interface QueueEvent {
  type: string
  job_id?: number
  overall_percent?: number
  display_name?: string
  message?: string
  error_message?: string
  track_id?: number
}
