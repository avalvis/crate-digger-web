from __future__ import annotations

from datetime import date
from pathlib import Path

from core.sampling_taxonomy import blended_score, sample_affinity
from core.database import VaultDatabase
from core.discovery import DiscogsCandidate, DiscoveryEngine, DiscoveryFilters, DiscoverySuggestion
from utils.paths import build_vault_track_dir, sanitize_filename_component


def test_vault_paths_remain_cross_platform_and_recent_first() -> None:
    path = build_vault_track_dir(
        Path("vault"),
        genre="Funk / Soul",
        bpm=93.6,
        camelot_key="8A",
        artist="Marlena Shaw",
        title="California Soul",
        filed_on=date(2026, 7, 17),
    )
    assert path == Path("vault/2026-07-17/Marlena Shaw_California Soul")
    assert sanitize_filename_component('CON') == 'CON_'
    assert sanitize_filename_component('A/B: C') == 'A_B_ C'


def test_sample_weighting_preserves_desirability_but_boosts_affinity() -> None:
    soulful = sample_affinity(
        genres=("Funk / Soul",), styles=("Soul", "Jazz-Funk"), country="US", year=1972,
    )
    neutral = sample_affinity(
        genres=("Pop",), styles=("Vocal",), country="US", year=2004,
    )
    assert soulful > neutral
    assert blended_score(0.5, soulful, 0.6) > blended_score(0.5, neutral, 0.6)


def test_producer_profile_suppresses_metal_and_edm_by_default(tmp_path: Path) -> None:
    db = VaultDatabase(tmp_path / "vault.db")
    engine = DiscoveryEngine(db, "test-token")

    def candidate(master_id: int, genre: str, style: str) -> DiscogsCandidate:
        return DiscogsCandidate(
            master_id=master_id,
            release_id=master_id,
            artist=f"Artist {master_id}",
            title=f"Record {master_id}",
            year=1972,
            country="US",
            genres=(genre,),
            styles=(style,),
            formats=("Vinyl",),
            have=80,
            want=100,
        )

    soul = candidate(1, "Funk / Soul", "Soul-Jazz")
    metal = candidate(2, "Rock", "Death Metal")
    edm = candidate(3, "Electronic", "Techno")
    ranked = engine._rank_and_shuffle(
        [metal, edm, soul],
        DiscoveryFilters(profile="boom_bap", sample_intensity=0.9),
    )
    db.close()

    assert [item.master_id for item in ranked] == [soul.master_id]
    assert soul.sample_affinity > metal.sample_affinity * 5
    assert soul.sample_affinity > edm.sample_affinity * 5


def test_discogs_candidate_keeps_cover_and_attribution_link() -> None:
    candidate = DiscoveryEngine._result_to_candidate({
        "master_id": 42,
        "id": 99,
        "title": "Dorothy Ashby - Afro-Harping",
        "year": "1968",
        "country": "US",
        "genre": ["Jazz"],
        "style": ["Soul-Jazz"],
        "format": ["Vinyl"],
        "community": {"have": 300, "want": 900},
        "cover_image": "https://i.discogs.com/example.jpg",
        "uri": "/master/42-Dorothy-Ashby-Afro-Harping",
    })
    assert candidate is not None
    assert candidate.artwork_url == "https://i.discogs.com/example.jpg"
    assert candidate.discogs_url == "https://www.discogs.com/master/42-Dorothy-Ashby-Afro-Harping"


def test_profile_reel_defers_country_repeats(tmp_path: Path) -> None:
    db = VaultDatabase(tmp_path / "vault.db")

    def candidate(master_id: int, country: str) -> DiscogsCandidate:
        return DiscogsCandidate(
            master_id=master_id,
            release_id=master_id,
            artist=f"Artist {master_id}",
            title=f"Record {master_id}",
            year=1974,
            country=country,
            genres=("Jazz",),
            styles=("Soul-Jazz",),
            formats=("Vinyl",),
            have=50,
            want=100,
        )

    pool = [
        candidate(1, "Brazil"), candidate(2, "Brazil"), candidate(3, "Brazil"),
        candidate(4, "France"), candidate(5, "Ghana"),
    ]
    diversified = DiscoveryEngine._diversify_candidate_pool(
        pool, DiscoveryFilters(profile="boom_bap"), count=8,
    )
    db.close()

    assert [item.master_id for item in diversified] == [1, 2, 4, 5, 3]


def test_various_artist_is_excluded_when_compilations_are_off() -> None:
    raw = {
        "master_id": 42,
        "id": 99,
        "title": "Various - Rare Brazilian Grooves",
        "year": "1974",
        "country": "Brazil",
        "genre": ["Funk / Soul"],
        "style": ["MPB"],
        "format": ["Vinyl"],
        "community": {"have": 300, "want": 900},
    }
    assert DiscoveryEngine._result_to_candidate(raw, allow_compilations=False) is None
    assert DiscoveryEngine._result_to_candidate(raw, allow_compilations=True) is not None


def test_strong_song_match_skips_redundant_video_search(
    tmp_path: Path, monkeypatch,
) -> None:
    db = VaultDatabase(tmp_path / "vault.db")
    engine = DiscoveryEngine(db, "test-token")
    candidate = DiscogsCandidate(
        master_id=42,
        release_id=99,
        artist="Dorothy Ashby",
        title="Afro-Harping",
        year=1968,
        country="US",
        genres=("Jazz",),
        styles=("Soul-Jazz",),
        formats=("Vinyl",),
        have=300,
        want=900,
    )
    calls: list[str] = []

    monkeypatch.setattr(engine, "_get_ytm_client", lambda: object())

    def search(_client, _query: str, search_filter: str):
        calls.append(search_filter)
        return [{
            "videoId": "gem42",
            "title": "Afro-Harping",
            "artists": [{"name": "Dorothy Ashby"}],
            "resultType": "song",
            "videoType": "MUSIC_VIDEO_TYPE_ATV",
        }]

    monkeypatch.setattr(engine, "_ytm_search", search)
    suggestion = engine._match_youtube(candidate)
    db.close()

    assert suggestion.youtube_video_id == "gem42"
    assert calls == ["songs"]


def test_final_resolved_reel_defers_country_and_lane_repeats(tmp_path: Path, monkeypatch) -> None:
    db = VaultDatabase(tmp_path / "vault.db")
    engine = DiscoveryEngine(db, "test-token")

    def candidate(master_id: int, country: str, genre: str, style: str) -> DiscogsCandidate:
        return DiscogsCandidate(
            master_id=master_id, release_id=master_id,
            artist=f"Artist {master_id}", title=f"Record {master_id}",
            year=1972, country=country, genres=(genre,), styles=(style,),
            formats=("Vinyl",), have=50, want=100,
        )

    pool = [
        candidate(1, "US", "Funk / Soul", "Soul"),
        candidate(2, "US", "Funk / Soul", "Funk"),
        candidate(3, "US", "Funk / Soul", "Soul"),
        candidate(4, "Brazil", "Latin", "MPB"),
        candidate(5, "Ghana", "Funk / Soul", "Afrobeat"),
        candidate(6, "France", "Stage & Screen", "Library Music"),
    ]
    monkeypatch.setattr(engine, "_search_discogs", lambda *_args, **_kwargs: pool)
    monkeypatch.setattr(engine, "_rank_and_shuffle", lambda *_args, **_kwargs: pool)

    def match(cand: DiscogsCandidate) -> DiscoverySuggestion:
        return DiscoverySuggestion(
            discogs_master_id=cand.master_id, discogs_release_id=cand.release_id,
            artist=cand.artist, title=cand.title, year=cand.year, country=cand.country,
            genre=cand.genres[0], style=cand.styles[0],
            youtube_url=f"https://youtube.com/watch?v=gem{cand.master_id}",
            youtube_video_id=f"gem{cand.master_id}", youtube_title=cand.title,
            youtube_duration_seconds=180, match_score=.95, sample_score=.9,
            sample_reasons=(),
        )

    monkeypatch.setattr(engine, "_match_youtube", match)
    reel = engine.dig_many(DiscoveryFilters(profile="boom_bap"), count=4)
    db.close()

    assert [item.discogs_master_id for item in reel] == [1, 2, 4, 6]


def test_interacted_discovery_is_excluded_by_a_new_engine(tmp_path: Path) -> None:
    db = VaultDatabase(tmp_path / "vault.db")
    first = DiscoveryEngine(db, "test-token")
    suggestion = DiscoverySuggestion(
        discogs_master_id=42, discogs_release_id=99, artist="Dorothy Ashby",
        title="Afro-Harping", year=1968, country="US", genre="Jazz",
        style="Soul-Jazz", youtube_url="https://youtube.com/watch?v=gem42",
        youtube_video_id="gem42", youtube_title="Afro-Harping",
        youtube_duration_seconds=180, match_score=.95, sample_score=.98,
        sample_reasons=(),
    )
    first.record_suggestion(suggestion)
    fresh = DiscogsCandidate(
        master_id=43, release_id=100, artist="Fresh Artist", title="Fresh Record",
        year=1971, country="US", genres=("Jazz",), styles=("Soul-Jazz",),
        formats=("Vinyl",), have=50, want=100,
    )
    heard = DiscogsCandidate(
        master_id=42, release_id=99, artist="Dorothy Ashby", title="Afro-Harping",
        year=1968, country="US", genres=("Jazz",), styles=("Soul-Jazz",),
        formats=("Vinyl",), have=50, want=100,
    )
    second = DiscoveryEngine(db, "test-token")
    ranked = second._rank_and_shuffle([heard, fresh], DiscoveryFilters())
    no_repeats = second._rank_and_shuffle([heard], DiscoveryFilters())
    db.close()

    assert [item.master_id for item in ranked] == [43]
    assert no_repeats == []
