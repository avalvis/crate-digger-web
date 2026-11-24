"""Regression tests for the data-integrity and robustness fixes."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from core.database import QueueJobRecord, TrackRecord, VaultDatabase, _execute_script
from core.downloader import is_permanent_download_error
from core.pipeline import IngestionPipeline, PipelineRequest
from core.preview_prefetch import PrefetchState, PreviewPrefetchService, _PrefetchEntry
from core.queue_manager import QueueManager, QueueManagerError
from cratedigger_api.app import create_app
from cratedigger_api.events import EventHub
from cratedigger_api.runtime import EngineRuntime, OperationCancelled

TOKEN = "robustness"
HEADERS = {"X-Crate-Token": TOKEN}


def wait_for(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("condition not reached in time")


# ── Database ──

def test_upsert_returns_the_existing_row_id_on_conflict(tmp_path):
    db = VaultDatabase(tmp_path / "vault.db")
    first = db.upsert_track(TrackRecord(file_path=str(tmp_path / "a.wav"), artist="A", title="One"))
    second = db.upsert_track(TrackRecord(file_path=str(tmp_path / "b.wav"), artist="B", title="Two"))
    # Updating the first row used to report the stale lastrowid (the second row).
    again = db.upsert_track(TrackRecord(file_path=str(tmp_path / "a.wav"), artist="A", title="One (edit)"))
    assert again == first != second
    assert db.get_track(first).title == "One (edit)"
    db.close()


def test_scripts_run_inside_the_callers_transaction(tmp_path):
    conn = sqlite3.connect(tmp_path / "x.db", isolation_level=None)
    conn.execute("BEGIN IMMEDIATE")
    with pytest.raises(sqlite3.OperationalError):
        _execute_script(conn, "CREATE TABLE kept (id INTEGER);\n-- comment\nINSERT INTO missing VALUES (1);\n")
    conn.rollback()
    # executescript would have committed CREATE TABLE before failing.
    assert conn.execute("SELECT name FROM sqlite_master WHERE name='kept'").fetchone() is None


def test_queue_status_compare_and_set(tmp_path):
    db = VaultDatabase(tmp_path / "vault.db")
    job_id = db.create_queue_job(QueueJobRecord(source_url="https://example.com/a", status="pending"))
    assert db.update_queue_job(job_id, status="downloading", expected_status=("pending",))
    assert not db.update_queue_job(job_id, status="cancelled", expected_status=("pending",))
    assert db.get_queue_job(job_id).status == "downloading"
    db.close()


# ── Queue ──

class GatedPipeline:
    """Fake pipeline whose runs block until released."""

    def __init__(self, audio: Path) -> None:
        self.audio = audio
        self.release = threading.Event()
        self.started: list[str] = []

    def run(self, request, progress_callback=None, cancel_event=None):
        self.started.append(request.source_url)
        self.release.wait(5)
        return SimpleNamespace(track_id=None, final_audio_path=self.audio,
                               analysis=SimpleNamespace(bpm=90.0, musical_key="Am", camelot_key="8A"),
                               total_elapsed_seconds=0.1, warning_message=None, warning_stage=None)


def test_pending_jobs_resume_after_restart_and_duplicates_are_rejected(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF")
    db = VaultDatabase(tmp_path / "vault.db")
    url = "https://example.com/left-waiting"
    waiting = db.create_queue_job(QueueJobRecord(
        source_url=url, status="pending",
        request_payload=json.dumps({"source_url": url, "display_name": "Waiting", "stem_model": "htdemucs"}),
    ))
    pipeline = GatedPipeline(audio)
    queue = QueueManager(pipeline=pipeline, database=db, num_workers=1)
    queue.start()
    try:
        wait_for(lambda: pipeline.started == [url])
        with pytest.raises(QueueManagerError, match="already in the queue"):
            queue.enqueue(PipelineRequest(source_url=url))
        pipeline.release.set()
        wait_for(lambda: db.get_queue_job(waiting).status not in {"pending", "downloading"})
    finally:
        pipeline.release.set()
        queue.shutdown()
        db.close()


def test_cancelled_pending_job_never_runs(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF")
    db = VaultDatabase(tmp_path / "vault.db")
    pipeline = GatedPipeline(audio)
    queue = QueueManager(pipeline=pipeline, database=db, num_workers=1)
    queue.start()
    try:
        first = queue.enqueue(PipelineRequest(source_url="https://example.com/first"))
        wait_for(lambda: pipeline.started == ["https://example.com/first"])
        second = queue.enqueue(PipelineRequest(source_url="https://example.com/second"))
        assert queue.cancel(second)
        assert db.get_queue_job(second).status == "cancelled"
        pipeline.release.set()
        wait_for(lambda: db.get_queue_job(first).status not in {"pending", "downloading"})
        time.sleep(0.2)
        assert pipeline.started == ["https://example.com/first"]
    finally:
        pipeline.release.set()
        queue.shutdown()
        db.close()


def test_queue_resize_adds_workers(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF")
    db = VaultDatabase(tmp_path / "vault.db")
    pipeline = GatedPipeline(audio)
    queue = QueueManager(pipeline=pipeline, database=db, num_workers=1)
    queue.start()
    try:
        queue.enqueue(PipelineRequest(source_url="https://example.com/1"))
        queue.enqueue(PipelineRequest(source_url="https://example.com/2"))
        wait_for(lambda: len(pipeline.started) == 1)
        queue.resize(2)
        wait_for(lambda: len(pipeline.started) == 2)
    finally:
        pipeline.release.set()
        queue.shutdown()
        db.close()


# ── Pipeline filing ──

def bare_pipeline(vault: Path) -> IngestionPipeline:
    pipeline = object.__new__(IngestionPipeline)
    pipeline._vault_root = vault
    pipeline._folder_scheme = "artist_title"
    pipeline._log = SimpleNamespace(warning=lambda *a, **k: None, info=lambda *a, **k: None)
    return pipeline


def test_vault_folders_are_reserved_not_shared(tmp_path):
    pipeline = bare_pipeline(tmp_path / "vault")
    paths = []
    for name in ("one", "two"):
        src = tmp_path / f"{name}.wav"
        src.write_bytes(b"RIFF")
        paths.append(pipeline._relocate_to_vault(src=src, genre=None, bpm=90.0, camelot_key="8A",
                                                 artist="Same Artist", title="Same Title", artwork=None))
    assert paths[0][1] != paths[1][1]
    assert paths[0][0].exists() and paths[1][0].exists()


def test_long_titles_stay_within_windows_path_limit(tmp_path):
    pipeline = bare_pipeline(tmp_path / "vault")
    src = tmp_path / "long.wav"
    src.write_bytes(b"RIFF")
    final, _ = pipeline._relocate_to_vault(src=src, genre=None, bpm=None, camelot_key=None,
                                           artist="A" * 200, title="T" * 200, artwork=None)
    assert len(str(final)) <= 250
    assert final.exists()


# ── Downloads, previews, streaming ──

@pytest.mark.parametrize(("message", "permanent"), [
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", True),
    ("ERROR: [youtube] abc: Video unavailable", True),
    ("ERROR: unable to download video data: HTTP Error 403: Forbidden", False),
    ("ERROR: [youtube] abc: Read timed out", False),
])
def test_permanent_download_errors_are_not_retried(message, permanent):
    assert is_permanent_download_error(Exception(message)) is permanent


def test_wait_ready_returns_immediately_for_cancelled_preview():
    preview = SimpleNamespace(normalize_video_id=lambda value: value)
    service = PreviewPrefetchService(preview)
    service._entries["dQw4w9WgXcQ"] = _PrefetchEntry(video_id="dQw4w9WgXcQ", state=PrefetchState.CANCELLED)
    started = time.monotonic()
    assert service.wait_ready("dQw4w9WgXcQ", timeout=5) is None
    assert time.monotonic() - started < 1


def test_cancelled_preview_is_not_reported_ready():
    service = PreviewPrefetchService(SimpleNamespace(normalize_video_id=lambda value: value))
    entry = _PrefetchEntry(video_id="dQw4w9WgXcQ")
    entry.cancel_event.set()
    assert not service._set(entry, state=PrefetchState.READY)
    assert service._set(entry, state=PrefetchState.CANCELLED)


def test_suffix_byte_range_returns_the_end_of_the_file(tmp_path, monkeypatch):
    audio = tmp_path / "clip.m4a"
    audio.write_bytes(bytes(range(100)))
    monkeypatch.setattr(EngineRuntime, "preview_path", lambda self, video_id: audio)
    with TestClient(create_app(data_dir=tmp_path / "data", api_token=TOKEN)) as client:
        response = client.get("/api/previews/dQw4w9WgXcQ/audio", headers={**HEADERS, "Range": "bytes=-10"})
    assert response.status_code == 206
    assert response.content == bytes(range(90, 100))


# ── Discovery ──

def test_dig_streams_progress_and_can_be_cancelled(tmp_path, monkeypatch):
    runtime = EngineRuntime(tmp_path / "data", EventHub())
    published: list[dict] = []
    monkeypatch.setattr(runtime.events, "publish", published.append)

    class SlowEngine:
        def dig_many(self, filters, count=8, *, cancel_event=None, progress=None):
            from core.discovery import DiscoveryCancelledError
            progress("Matching on YouTube — 0/8…")
            if cancel_event.wait(5):
                raise DiscoveryCancelledError("Dig cancelled by user")
            return []

    monkeypatch.setattr(runtime, "ensure_discovery", lambda: SlowEngine())
    outcome: list[BaseException] = []

    def dig() -> None:
        try:
            runtime.discover({"count": 8})
        except BaseException as exc:  # noqa: BLE001
            outcome.append(exc)

    worker = threading.Thread(target=dig)
    worker.start()
    wait_for(lambda: published)
    assert runtime.cancel_discovery() == 1
    worker.join(5)
    assert isinstance(outcome[0], OperationCancelled)
    assert published[0] == {"type": "discovery_progress", "message": "Matching on YouTube — 0/8…"}
    runtime.close()


# ── Connectivity ──

def test_query_token_only_unlocks_media_routes(tmp_path, monkeypatch):
    audio = tmp_path / "clip.m4a"
    audio.write_bytes(b"0123456789")
    monkeypatch.setattr(EngineRuntime, "preview_path", lambda self, video_id: audio)
    with TestClient(create_app(data_dir=tmp_path / "data", api_token=TOKEN)) as client:
        assert client.get(f"/api/health?token={TOKEN}").status_code == 401
        assert client.get(f"/api/previews/dQw4w9WgXcQ/audio?token={TOKEN}").status_code == 200


def test_event_socket_sends_heartbeats_and_sequenced_events(tmp_path, monkeypatch):
    import cratedigger_api.app as app_module

    monkeypatch.setattr(app_module, "HEARTBEAT_SECONDS", 0.05)
    with TestClient(create_app(data_dir=tmp_path / "data", api_token=TOKEN)) as client:
        with client.websocket_connect(f"/api/events?token={TOKEN}") as socket:
            assert socket.receive_json() == {"type": "ping"}
            hub = client.app.state.event_hub
            hub.publish({"type": "discovery_progress", "message": "one"})
            hub.publish({"type": "discovery_progress", "message": "two"})
            events = [socket.receive_json() for _ in range(2)]
            events = [event for event in events if event["type"] != "ping"] or events
            first = next(event for event in events if event.get("message") == "one")
            assert first["seq"] >= 1


def test_sidecar_binds_its_own_port_and_reports_it(tmp_path):
    import os
    import subprocess
    import sys
    import urllib.request

    env = {**os.environ, "CRATEDIGGER_PORT": "0", "CRATEDIGGER_TOKEN": TOKEN,
           "CRATEDIGGER_DATA_DIR": str(tmp_path / "data"), "PYTHONUNBUFFERED": "1"}
    proc = subprocess.Popen([sys.executable, "sidecar_entry.py"], cwd=Path(__file__).parents[1], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        line = proc.stdout.readline()
        assert line.startswith("CRATEDIGGER_LISTENING port=")
        port = int(line.strip().split("=", 1)[1])
        assert port > 0
        deadline = time.monotonic() + 20
        while True:
            try:
                request = urllib.request.Request(f"http://127.0.0.1:{port}/api/health", headers=HEADERS)
                with urllib.request.urlopen(request, timeout=2) as response:
                    assert response.status == 200
                    break
            except OSError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.2)
    finally:
        proc.kill()
        proc.wait(10)


# ── Listening history ──

def _suggestion(video_id: str, master: int) -> dict:
    return {"discogs_master_id": master, "artist": "Artist", "title": f"Song {master}",
            "youtube_url": f"https://youtube.com/watch?v={video_id}", "youtube_video_id": video_id}


def test_listening_history_counts_plays_and_keeps(tmp_path):
    with TestClient(create_app(data_dir=tmp_path / "data", api_token=TOKEN)) as client:
        a, b = _suggestion("dQw4w9WgXcQ", 1), _suggestion("9bZkp7q19f0", 2)
        assert client.post("/api/listening/plays", headers=HEADERS, json={"suggestion": a}).status_code == 204
        assert client.post("/api/listening/plays", headers=HEADERS, json={"suggestion": a}).status_code == 204
        # Keeping works for a record that was never played.
        assert client.put("/api/listening/likes", headers=HEADERS, json={"suggestion": b, "liked": True}).status_code == 204

        history = client.get("/api/listening", headers=HEADERS).json()
        assert history["total"] == 2
        entries = {item["suggestion"]["youtube_video_id"]: item for item in history["items"]}
        assert entries["dQw4w9WgXcQ"]["play_count"] == 2 and not entries["dQw4w9WgXcQ"]["liked"]
        assert entries["9bZkp7q19f0"]["liked"] and entries["9bZkp7q19f0"]["play_count"] == 0

        kept = client.get("/api/listening?filter=liked", headers=HEADERS).json()
        assert [item["suggestion"]["title"] for item in kept["items"]] == ["Song 2"]

        states = client.get("/api/listening/states?video_ids=dQw4w9WgXcQ,9bZkp7q19f0,bad", headers=HEADERS).json()
        assert {s["video_id"]: (s["play_count"], s["liked"]) for s in states} == {
            "dQw4w9WgXcQ": (2, False), "9bZkp7q19f0": (0, True)}

        client.put("/api/listening/likes", headers=HEADERS, json={"suggestion": b, "liked": False})
        assert client.get("/api/listening?filter=liked", headers=HEADERS).json()["total"] == 0


def test_listening_requires_a_playable_source(tmp_path):
    with TestClient(create_app(data_dir=tmp_path / "data", api_token=TOKEN)) as client:
        demo = {"discogs_master_id": 5, "artist": "A", "title": "T"}
        assert client.post("/api/listening/plays", headers=HEADERS, json={"suggestion": demo}).status_code == 422
