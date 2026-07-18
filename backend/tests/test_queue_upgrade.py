from __future__ import annotations

import time
import json
import os
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from core.database import QueueJobRecord, TrackRecord, VaultDatabase
from core.pipeline import PipelineProgress, PipelineRequest, PipelineStage
from core.queue_manager import QueueManager
from core.stems import StemModel, StemSeparator
from sidecar_entry import _configure_utf8_stdio
from cratedigger_api.app import create_app
from cratedigger_api.runtime import default_data_dir
from utils.config import GeneralConfig


TOKEN = "queue-test"
HEADERS = {"X-Crate-Token": TOKEN}


def wait_for_status(db: VaultDatabase, job_id: int, statuses: set[str]) -> QueueJobRecord:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = db.get_queue_job(job_id)
        if job.status in statuses:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach {statuses}")


def test_web_profile_defaults_never_point_at_legacy_locations(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))
    monkeypatch.delenv("CRATEDIGGER_DATA_DIR", raising=False)
    data_dir = default_data_dir()
    defaults = GeneralConfig()

    assert data_dir == tmp_path / "Local" / "com.cratedigger.desktop"
    combined = " ".join((str(data_dir), defaults.vault_root, defaults.staging_root, defaults.mpc_samples_root))
    assert "CrateDigger_Vault" not in combined
    assert "CrateDigger_MPC" not in combined
    assert str(Path.home() / ".cratedigger") not in combined


def test_queue_archive_history_and_api_summary(tmp_path: Path) -> None:
    data_dir = tmp_path / "profile"
    app = create_app(data_dir=data_dir, api_token=TOKEN)
    with TestClient(app) as client:
        db = VaultDatabase(data_dir / "vault.db")
        running_id = db.create_queue_job(QueueJobRecord(
            source_url="https://example.com/running",
            display_name="Running break",
            status="analyzing",
            origin="digital_crate",
            progress_pct=55,
            stage_percent=20,
            current_stage="analyzing",
            status_message="Finding BPM",
        ))
        complete_id = db.create_queue_job(QueueJobRecord(
            source_url="https://example.com/ready",
            display_name="Ready break",
            status="complete",
            progress_pct=100,
            current_stage="complete",
            status_message="Track ready in the Vault",
            completed_at="2026-07-17T20:00:00+00:00",
        ))
        warning_id = db.create_queue_job(QueueJobRecord(
            source_url="https://example.com/warning",
            display_name="Stem warning",
            status="complete_with_warnings",
            progress_pct=100,
            current_stage="complete",
            failure_stage="separating_stems",
            error_message="Demucs failed",
            completed_at="2026-07-17T20:01:00+00:00",
        ))
        db.close()

        page = client.get("/api/jobs?view=queue", headers=HEADERS).json()
        assert page["summary"] == {
            "running": 1, "waiting": 0, "completed": 1, "attention": 1,
            "current_job_id": running_id,
        }
        assert {item["id"] for item in page["items"]} == {running_id, complete_id, warning_id}
        assert next(item for item in page["items"] if item["id"] == running_id)["status_message"] == "Finding BPM"

        cleared = client.post("/api/jobs/archive-completed", headers=HEADERS)
        assert cleared.status_code == 200
        assert cleared.json()["affected"] == 1
        live_ids = {item["id"] for item in client.get("/api/jobs?view=queue", headers=HEADERS).json()["items"]}
        assert complete_id not in live_ids
        assert warning_id in live_ids
        history_ids = {item["id"] for item in client.get("/api/jobs?view=history", headers=HEADERS).json()["items"]}
        assert {complete_id, warning_id}.issubset(history_ids)


def test_v1_queue_schema_migrates_before_archived_index_is_created(tmp_path: Path) -> None:
    path = tmp_path / "vault.db"
    VaultDatabase(path).close()
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            DROP INDEX IF EXISTS idx_queue_archived;
            DROP INDEX IF EXISTS idx_queue_status;
            DROP INDEX IF EXISTS idx_queue_created;
            ALTER TABLE queue_jobs RENAME TO queue_jobs_v2;
            CREATE TABLE queue_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_url TEXT NOT NULL,
                display_name TEXT,
                status TEXT NOT NULL,
                progress_pct REAL NOT NULL DEFAULT 0,
                current_stage TEXT,
                error_message TEXT,
                track_id INTEGER,
                enable_stems INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT
            );
            DROP TABLE queue_jobs_v2;
            UPDATE app_metadata SET value='1' WHERE key='schema_version';
        """)

    migrated = VaultDatabase(path)
    job_id = migrated.create_queue_job(QueueJobRecord(
        source_url="https://example.com/migrated",
        status="complete_with_warnings",
        failure_stage="separating_stems",
    ))
    assert migrated.get_queue_job(job_id).status == "complete_with_warnings"
    assert migrated.get_meta("schema_version") == "2"
    migrated.close()


class WarningThenStemSuccessPipeline:
    def __init__(self, audio: Path) -> None:
        self.audio = audio
        self.ingestions = 0
        self.stem_retries = 0

    def run(self, request, progress_callback=None, cancel_event=None):
        self.ingestions += 1
        if progress_callback:
            progress_callback(PipelineProgress(
                stage=PipelineStage.SEPARATING_STEMS,
                overall_percent=95,
                stage_percent=80,
                message="Separating stems",
                display_name="Rare Artist — Dusty Loop",
            ))
        return SimpleNamespace(
            track_id=1,
            final_audio_path=self.audio,
            analysis=SimpleNamespace(bpm=88.0, musical_key="Am", camelot_key="8A"),
            total_elapsed_seconds=1.5,
            warning_message="Stem separation failed: worker error",
            warning_stage="separating_stems",
        )

    def separate_existing_track(self, track_id, **kwargs):
        self.stem_retries += 1
        callback = kwargs.get("progress_callback")
        if callback:
            callback(PipelineProgress(
                stage=PipelineStage.SEPARATING_STEMS,
                overall_percent=100,
                stage_percent=100,
                message="Stems complete",
                display_name="Rare Artist — Dusty Loop",
            ))
        return SimpleNamespace(output_dir=self.audio.parent / "stems")


def test_stem_warning_keeps_track_and_retry_skips_ingestion(tmp_path: Path) -> None:
    audio = tmp_path / "rare.wav"
    audio.write_bytes(b"RIFF" + b"\0" * 100)
    db = VaultDatabase(tmp_path / "vault.db")
    track_id = db.upsert_track(TrackRecord(
        file_path=str(audio), artist="Rare Artist", title="Dusty Loop",
        source_url="https://example.com/rare", source_platform="manual",
    ))
    assert track_id == 1
    pipeline = WarningThenStemSuccessPipeline(audio)
    queue = QueueManager(pipeline=pipeline, database=db, num_workers=1)
    queue.start()
    try:
        job_id = queue.enqueue(PipelineRequest(
            source_url="https://example.com/rare",
            display_name="Rare Artist — Dusty Loop",
            origin="digital_crate",
            enable_stems=True,
            output_format="mp3",
        ))
        assert json.loads(db.get_queue_job(job_id).request_payload or "{}")["output_format"] == "mp3"
        warning = wait_for_status(db, job_id, {"complete_with_warnings"})
        assert warning.track_id == track_id
        assert warning.failure_stage == "separating_stems"

        retry_id = queue.retry(job_id)
        completed = wait_for_status(db, retry_id, {"complete", "failed"})
        assert completed.status == "complete"
        assert completed.operation == "stems"
        assert completed.retry_of_job_id == job_id
        assert pipeline.ingestions == 1
        assert pipeline.stem_retries == 1
    finally:
        queue.shutdown()
        db.close()


def test_frozen_separator_dispatches_internal_worker_instead_of_python_c(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    separator = StemSeparator()
    audio = tmp_path / "input.wav"
    audio.write_bytes(b"RIFF" + b"\0" * 100)
    captured: dict[str, list[str]] = {}

    monkeypatch.setattr(separator, "_prepare_runtime", lambda model, callback: StemModel.HTDEMUCS)
    monkeypatch.setattr(separator, "_resolve_device", lambda: "cpu")
    monkeypatch.setattr(
        separator,
        "_run_demucs",
        lambda command, callback, cancel, started: captured.update(command=command),
    )
    monkeypatch.setattr(
        separator,
        "_collect_stems",
        lambda **kwargs: {"vocals": kwargs["output_dir"] / "vocals.wav"},
    )

    separator.separate(audio, tmp_path / "stems")
    assert captured["command"][1] == "--internal-demucs"
    assert "-c" not in captured["command"]


def test_frozen_worker_reconfigures_live_streams_for_unicode_paths(monkeypatch) -> None:
    class Stream:
        def __init__(self) -> None:
            self.calls: list[dict[str, str]] = []

        def reconfigure(self, **values: str) -> None:
            self.calls.append(values)

    stdout = Stream()
    stderr = Stream()
    monkeypatch.delenv("PYTHONUTF8", raising=False)
    monkeypatch.delenv("PYTHONIOENCODING", raising=False)
    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(sys, "stderr", stderr)

    _configure_utf8_stdio()

    assert stdout.calls == [{"encoding": "utf-8", "errors": "replace"}]
    assert stderr.calls == [{"encoding": "utf-8", "errors": "replace"}]
    assert os.environ["PYTHONUTF8"] == "1"
    assert os.environ["PYTHONIOENCODING"] == "utf-8"
