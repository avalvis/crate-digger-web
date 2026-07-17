from __future__ import annotations

from datetime import date
from pathlib import Path

from core.sampling_taxonomy import blended_score, sample_affinity
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

