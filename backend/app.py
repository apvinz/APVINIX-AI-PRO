"""APVINIX AI — audio to MusicXML API. Host separately from Netlify."""
from __future__ import annotations

import json
import importlib.util
import os
import logging
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from transcriber import transcribe

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "_jobs"
DATA.mkdir(exist_ok=True)
MAX_UPLOAD = 60 * 1024 * 1024
ALLOWED = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".opus"}
DOWNLOADS = {
    "musicxml": ("partitur.musicxml", "application/vnd.recordare.musicxml+xml"),
    "midi": ("partitur.mid", "audio/midi"),
    "mxl": ("partitur.mxl", "application/vnd.recordare.musicxml"),
    "zip": ("hasil-partitur.zip", "application/zip"),
    "raw_midi": ("transkripsi-mentah.mid", "audio/midi"),
    "quality": ("laporan-kualitas.json", "application/json"),
}
app = FastAPI(title="APVINIX AI Transcription API", version="2.0.0")
# Set CORS_ORIGINS=https://your-site.netlify.app for production.
allowed_origins = [s.strip() for s in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if s.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST"], allow_headers=["*"], max_age=600)
logger = logging.getLogger("apvinix")
_jobs: dict[str, dict] = {}
_lock = threading.Lock()
# Prevent simultaneous Demucs/PyTorch workloads from exhausting small hosts.
_engine_slots = threading.Semaphore(1)


def patch_job(job_id, **kwargs):
    with _lock:
        _jobs[job_id].update(kwargs)


def expire_jobs():
    # Clean stale completed jobs (and their audio files) after 6 hours.
    now = time.time()
    with _lock:
        stale = [job_id for job_id, item in _jobs.items()
                 if item["state"] in ("done", "error") and now - item["updated"] > 21600]
        for jid in stale:
            _jobs.pop(jid, None)
    for jid in stale:
        shutil.rmtree(DATA / jid, ignore_errors=True)


def run_job(job_id: str, options: dict):
    folder = DATA / job_id
    source = next(folder.glob("input.*"))
    def report(message, progress):
        patch_job(job_id, stage=message, progress=progress, updated=time.time())
    patch_job(job_id, state="working", updated=time.time())
    try:
        report("Menunggu giliran mesin AI…", 4)
        with _engine_slots:
            info = transcribe(source, folder, options, report)
        patch_job(job_id, state="done", info=info, updated=time.time())
    except Exception as exc:
        logger.exception("Transcription failed: %s", job_id)
        patch_job(job_id, state="error", stage=str(exc)[:1000], updated=time.time())
    finally:
        source.unlink(missing_ok=True)  # remove private original audio
        (folder / "audio.wav").unlink(missing_ok=True)
        shutil.rmtree(folder / "stems", ignore_errors=True)


@app.get("/")
def index():
    return {"name": "APVINIX AI Transcription API", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health():
    engines = {
        "basic_pitch": importlib.util.find_spec("basic_pitch") is not None,
        "demucs": importlib.util.find_spec("demucs") is not None,
        "piano": importlib.util.find_spec("piano_transcription_inference") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
    }
    return {"ok": True, "service": "APVINIX AI", "modes": ["solo", "studio", "piano"],
            "engines_installed": engines,
            "note": "Engine terpasang belum berarti bobot model atau sumber daya GPU telah diuji."}


@app.post("/api/transcribe", status_code=202)
async def start(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form("Partitur Transkripsi"),
    mode: str = Form("solo"),
    time_signature: str = Form("4/4"),
    tempo_mode: str = Form("auto"),
    bpm: int = Form(120),
    sensitivity: float = Form(0.5),
    subdivision: int = Form(4),
):
    if mode not in ("solo", "studio", "piano"):
        raise HTTPException(422, "Mode tidak dikenali")
    if time_signature not in ("4/4", "3/4", "6/8"):
        raise HTTPException(422, "Birama tidak didukung")
    if not 40 <= bpm <= 220:
        raise HTTPException(422, "BPM harus 40–220")
    if not 0.2 <= sensitivity <= 0.85:
        raise HTTPException(422, "Sensitivitas tidak valid")
    if subdivision not in (2, 4, 8):
        raise HTTPException(422, "Resolusi tidak valid")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, f"Format tidak didukung. Gunakan: {', '.join(sorted(ALLOWED))}")
    job_id = uuid.uuid4().hex
    folder = DATA / job_id
    folder.mkdir(parents=True)
    source = folder / ("input" + suffix)
    size = 0
    try:
        with source.open("wb") as fh:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "Ukuran file maksimal 60 MB")
                fh.write(chunk)
        if size < 256:
            raise HTTPException(400, "File kosong atau terlalu kecil")
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    finally:
        await file.close()
    options = {
        "title": re.sub(r"[\x00-\x1f<>]", "", title).strip()[:110] or "Partitur Transkripsi",
        "mode": mode, "time_signature": time_signature, "bpm_auto": tempo_mode != "manual",
        "bpm": bpm, "onset_threshold": max(0.22, 0.95 - sensitivity * 0.9),
        "frame_threshold": max(0.15, 0.65 - sensitivity * 0.5),
        "min_note_ms": 100, "subdivision": subdivision,
    }
    expire_jobs()
    with _lock:
        _jobs[job_id] = {"id": job_id, "state": "queued", "stage": "Masuk antrean…",
                         "progress": 2, "updated": time.time(), "info": None}
    background_tasks.add_task(run_job, job_id, options)
    return {"id": job_id, "state": "queued"}


@app.get("/api/jobs/{job_id}")
def status(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Pekerjaan tidak ditemukan / sudah kedaluwarsa")
        return dict(job)


@app.get("/api/jobs/{job_id}/download/{kind}")
def download(job_id: str, kind: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise HTTPException(404, "ID tidak valid")
    with _lock:
        job = _jobs.get(job_id)
    if not job or job["state"] != "done" or kind not in DOWNLOADS:
        raise HTTPException(404, "File belum tersedia")
    name, mime = DOWNLOADS[kind]
    path = DATA / job_id / name
    if not path.exists():
        raise HTTPException(404, "File tidak ditemukan")
    return FileResponse(path, media_type=mime, filename=name)


@app.get("/api/jobs/{job_id}/score")
def score(job_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise HTTPException(404, "ID tidak valid")
    with _lock:
        job = _jobs.get(job_id)
    if not job or job["state"] != "done":
        raise HTTPException(404, "Partitur belum tersedia")
    return FileResponse(DATA / job_id / "partitur.musicxml", media_type="application/xml",
                        headers={"Cache-Control": "no-store"})


@app.get("/api/jobs/{job_id}/notes")
def notes_json(job_id: str):
    """Return time-coded note events for the browser score preview/editor."""
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise HTTPException(404, "ID tidak valid")
    with _lock:
        job = _jobs.get(job_id)
    if not job or job["state"] != "done":
        raise HTTPException(404, "Not belum tersedia")
    path = DATA / job_id / "notes.json"
    if not path.exists():
        raise HTTPException(404, "Data not belum tersedia")
    return json.loads(path.read_text(encoding="utf-8"))
