from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from core.database import (
    CrateAssignmentConflictError,
    TrackRecord,
    VaultDatabase,
)


def add_track(db: VaultDatabase, path: Path, title: str) -> int:
    path.write_bytes(b"audio")
    return db.upsert_track(TrackRecord(
        file_path=str(path), artist="Test Artist", title=title,
        genre="Jazz", source_url=f"https://example.com/{title}", source_platform="manual",
    ))


def test_exclusive_assignment_is_atomic_and_never_deletes_tracks(tmp_path: Path) -> None:
    db = VaultDatabase(tmp_path / "vault.db")
    first = add_track(db, tmp_path / "first.m4a", "First")
    second = add_track(db, tmp_path / "second.m4a", "Second")
    dusty = db.create_crate("Dusty", color="#D47432")
    night = db.create_crate("Night", color="#3D6F9D")

    assert db.assign_tracks_to_crate(dusty, [first, second]).assigned == 2
    with pytest.raises(CrateAssignmentConflictError) as error:
        db.assign_tracks_to_crate(night, [first, second])
    assert {item["track_id"] for item in error.value.conflicts} == {first, second}
    assert db.get_track(first).crate_id == dusty

    moved = db.assign_tracks_to_crate(night, [first, second], allow_moves=True)
    assert moved.moved == 2
    assert db.get_track(first).crate_id == night
    db.delete_crate(night)
    assert db.get_track(first).crate_id is None
    assert db.get_track(second).file_path == str(tmp_path / "second.m4a")
    db.close()


def test_v2_migration_keeps_latest_membership_then_lowest_crate_id(tmp_path: Path) -> None:
    path = tmp_path / "vault.db"
    db = VaultDatabase(path)
    first = add_track(db, tmp_path / "first.m4a", "First")
    second = add_track(db, tmp_path / "second.m4a", "Second")
    db.close()

    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.executescript("""
            DROP TABLE crate_tracks;
            DROP TABLE crates;
            CREATE TABLE crates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE crate_tracks (
                crate_id INTEGER NOT NULL,
                track_id INTEGER NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (crate_id, track_id),
                FOREIGN KEY (crate_id) REFERENCES crates(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_crate_tracks_crate ON crate_tracks(crate_id);
            CREATE INDEX idx_crate_tracks_track ON crate_tracks(track_id);
            INSERT INTO crates(id,name,description,created_at) VALUES
                (1,'First crate',NULL,'2026-01-01'), (2,'Second crate',NULL,'2026-01-01');
        """)
        conn.executemany(
            "INSERT INTO crate_tracks(crate_id,track_id,added_at) VALUES(?,?,?)",
            [(1, first, "2026-01-01"), (2, first, "2026-02-01"),
             (1, second, "2026-03-01"), (2, second, "2026-03-01")],
        )
        conn.execute("UPDATE app_metadata SET value='2' WHERE key='schema_version'")

    migrated = VaultDatabase(path)
    assert migrated.get_meta("schema_version") == "3"
    assert migrated.get_track(first).crate_id == 2
    assert migrated.get_track(second).crate_id == 1
    assert migrated.get_track(first).title == "First"
    migrated.close()
