from __future__ import annotations

import json
import wave
from pathlib import Path

from fastapi.testclient import TestClient

from core.database import TrackRecord, VaultDatabase
from cratedigger_api.app import create_app


TOKEN = "test-session"
HEADERS = {"X-Crate-Token": TOKEN}


def client_for(tmp_path: Path) -> TestClient:
    return TestClient(create_app(data_dir=tmp_path / "data", api_token=TOKEN))


def test_auth_and_health(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        assert client.get("/api/health").status_code == 401
        response = client.get("/api/health", headers=HEADERS)
        assert response.status_code == 200
        assert response.json() == {
            "status": "ok",
            "version": "0.1.1",
            "engine_ready": False,
            "engine_error": None,
        }


def test_demo_dig_without_discogs_token(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        response = client.post(
            "/api/discovery/dig",
            headers=HEADERS,
            json={"count": 3, "prioritize_samples": True},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["demo"] is True
        assert len(payload["items"]) == 3
        assert all(item["sample_friendly"] for item in payload["items"])


def test_config_and_crate_contracts(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        config = client.get("/api/config", headers=HEADERS).json()
        assert "general" in config["config"]

        patched = client.patch(
            "/api/config",
            headers=HEADERS,
            json={"section": "general", "values": {"concurrent_workers": 3}},
        )
        assert patched.status_code == 200
        assert patched.json()["config"]["general"]["concurrent_workers"] == 3

        created = client.post(
            "/api/crates",
            headers=HEADERS,
            json={"name": "Dusty drums", "description": "Breaks for tape one"},
        )
        assert created.status_code == 201
        crate_id = created.json()["id"]
        assert client.get("/api/crates", headers=HEADERS).json()[0]["track_count"] == 0
        assert client.delete(f"/api/crates/{crate_id}", headers=HEADERS).status_code == 204


def test_blank_library_paths_are_restored_to_defaults(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "config.json").write_text(
        json.dumps({
            "general": {
                "vault_root": "",
                "staging_root": "   ",
                "mpc_samples_root": "",
            },
        }),
        encoding="utf-8",
    )

    with client_for(tmp_path) as client:
        general = client.get("/api/config", headers=HEADERS).json()["config"]["general"]
        assert general["vault_root"]
        assert general["staging_root"].strip()
        assert general["mpc_samples_root"]

    persisted = json.loads((data_dir / "config.json").read_text(encoding="utf-8"))
    assert persisted["general"]["vault_root"]
    assert persisted["general"]["staging_root"].strip()
    assert persisted["general"]["mpc_samples_root"]


def test_track_search_patch_and_byte_range(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    audio = tmp_path / "break.wav"
    with wave.open(str(audio), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8000)
        handle.writeframes(b"\x00\x00" * 8000)

    with client_for(tmp_path) as client:
        db = VaultDatabase(data_dir / "vault.db")
        track_id = db.upsert_track(TrackRecord(
            file_path=str(audio),
            artist="The Test Pressing",
            title="Basement Break",
            genre="Funk / Soul",
            year=1974,
            duration_seconds=1.0,
            bpm=92.0,
            camelot_key="8A",
            source_url="https://example.com/source",
            source_platform="manual",
        ))
        db.close()

        page = client.get("/api/tracks?query=Basement", headers=HEADERS)
        assert page.status_code == 200
        assert page.json()["total"] == 1
        assert page.json()["items"][0]["file_available"] is True

        patched = client.patch(
            f"/api/tracks/{track_id}",
            headers=HEADERS,
            json={"rating": 5, "notes": "Loop the first bar", "tags": ["drums", "dusty"]},
        )
        assert patched.status_code == 200
        assert patched.json()["rating"] == 5
        assert patched.json()["tags"] == ["drums", "dusty"]

        streamed = client.get(
            f"/api/tracks/{track_id}/audio?token={TOKEN}",
            headers={"Range": "bytes=0-99"},
        )
        assert streamed.status_code == 206
        assert streamed.headers["content-range"].startswith("bytes 0-99/")
        assert len(streamed.content) == 100


def test_error_shape_is_stable(tmp_path: Path) -> None:
    with client_for(tmp_path) as client:
        response = client.get("/api/tracks/999999", headers=HEADERS)
        assert response.status_code == 404
        assert response.json()["detail"] == {
            "code": "track_not_found",
            "message": "Track not found",
        }
