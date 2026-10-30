# APVINIX AI PRO — Audio → editable sheet music

> **IMPORTANT:** This is working source code for *automatic transcription*, **not** a claim of 100% audio-to-score accuracy. Without a human-made reference score it is mathematically impossible for this app to verify every note of an arbitrary mixed song. Mixed audio with reverb, synths, distortion, overlapping instruments and singing can produce false/missed notes.

## Which version should I deploy?

| Component | Technology | Run location | What it can do |
|---|---|---|---|
| `netlify-drop/` | HTML/CSS/JavaScript + Basic Pitch JS (via CDN) | **Netlify Drop** | Upload audio, preview, download MusicXML and MIDI. AI must download in the user's browser; if this fails it **shows an error** for the AI-only mode. Explicit local pitch detection is a lower-quality option suitable for single-note melodies. |
| `frontend/` | React, TypeScript, Vite, Web Worker | **Netlify Git deploy / Netlify build** | Dashboard, local melodi, studio connection, instrument settings, note list/editor, quality panel, preview and MusicXML/MIDI downloads. |
| `backend/` | Python 3.11, FastAPI, FFmpeg, librosa, Basic Pitch, Demucs (optional), PyTorch piano model (optional) | **Docker/VPS/computing host**, NOT Netlify | Model inference, optional stem separation/piano-specific model, MusicXML/MXL/MIDI/raw MIDI and JSON quality report. |

## Immediate Netlify Drop upload (no Python)

1. Extract `APVINIX-AI-PRO-NETLIFY.zip`.
2. Upload **the extracted folder containing `index.html`** at https://app.netlify.com/drop (not the source project root).
3. First click **Coba contoh** then convert with mode **Deteksi melodi lokal** to check that the static site can operate without downloading a model.
4. For a real solo melody, try **Basic Pitch AI (browser)**. This needs external CDNs/models and has not been verified for real recordings in the current testing environment.
5. If you choose Studio AI mode before connecting a server, the site will correctly request a backend URL rather than pretending to run heavy Python on Netlify.

Netlify Drop does **not** run `backend/`. A frontend deploy alone cannot offer the full heavy AI engine.

## Real Studio AI — local test with Python 3.11

Install **FFmpeg** available in PATH. In a terminal:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
# Optional for mixed songs (large install / weights):
pip install -r requirements-studio.txt
# Optional for solo-piano recordings (large, experimental compatibility):
pip install -r requirements-piano.txt
# Windows PowerShell: $env:CORS_ORIGINS="http://localhost:5173,https://YOUR-SITE.netlify.app"
# Linux/macOS:
export CORS_ORIGINS='http://localhost:5173,https://YOUR-SITE.netlify.app'
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1
```

Test http://127.0.0.1:8000/api/health. Check `engines_installed`: `false` means the selected backend model is not installed. `true` **only indicates the Python module is present**, not that inference weights have been downloaded or that hardware works.

To deploy with Docker, set the *build context to `backend/`*, build its `Dockerfile` on a host supporting long-running CPU/GPU tasks, and use `PORT=8000`. Set `CORS_ORIGINS` to the precise Netlify domain (and localhost for testing). Public servers should add authentication, request rate limits, quotas and persistent job storage before taking untrusted public uploads. This demo uses single-process in-memory job state; restarting the service loses job statuses. Jobs are removed after six hours. The semaphore limits inference to one job at a time per process.

### Netlify Git deploy React version

- Use `frontend/` as **base directory**.
- Build command: `npm run build`
- Publish directory: `dist`
- Optional `VITE_API_URL=https://YOUR-BACKEND.example.com` at build time; otherwise enter the backend URL in the application's Settings dialog.
- Verify that CORS on Python contains your website's HTTPS origin.

**Note:** React npm dependencies could not be fetched during construction (network DNS), therefore the React production build **is not yet verified**. The separate static Netlify Drop build has no npm dependencies and its notation logic was tested.

## Which engine to use?

- **Local engine**: one dominant-note melody, used for a quick smoke test. NOT suitable for songs with multiple instruments.
- **Basic Pitch AI solo**: polyphonic note events for a mostly isolated instrument; best on one instrument at a time. It is not a full-band transcription engine.
- **Studio 4 stems**: Demucs produces vocals/bass/other/drums. Basic Pitch estimates notes from vocals, bass and `other`; drum notes are **heuristic guesses** (not trained drum transcription). All these estimates require listening and correction. Stems may leak between instruments.
- **Piano AI**: separate high-resolution piano model (optional `piano_transcription_inference`), intended for a predominantly piano recording. The score splits around middle C into two tentative parts; hand assignment is not guaranteed. First inference may download model files.

## What is in the output?

- `partitur.musicxml` — standard editable notation for MuseScore (including rests, ties and voices)
- `partitur.mxl` — compressed MusicXML
- `partitur.mid` — quantized MIDI that corresponds to the notation
- `transkripsi-mentah.mid` — original AI note timings **before** snapping to the rhythm grid
- `laporan-kualitas.json` — flags for sparse/overdense notes, approximate drums, instrument leakage and a sampled **spectral evidence indicator**
- `hasil-partitur.zip` — all of these files

### Why quality report doesn't show an accuracy percentage

Without a reference, the model cannot know what the correct notes are. `fraction_supported` only checks whether some pitch-class energy exists in the original audio at selected note times. Harmonically related errors and mixed instruments can fool it. Even a good indicator does **not** mean the transcription is accurate. The status is either `provisional` or `review`; never `100% verified`. If you want reliable scores, compare source audio with generated MIDI and correct notes in MuseScore.

## Tests executed while building

```bash
cd backend
PYTHONPATH=. python -m pytest -q   # Windows: $env:PYTHONPATH="."; python -m pytest -q
cd ../netlify-drop
node --test tests/*.mjs
```

Executed: **12 backend tests + 6 static frontend tests = 18 passing**. Backend tests *mock* expensive AI predictions; they verify conversion/API/exports, not model quality on commercially released recordings. The test suite has not independently verified files in a real MuseScore installation. A real-song end-to-end QA pass remains necessary before calling the service production-ready.

### Troubleshooting

- Netlify shows the site but Studio AI fails: Python backend is not deployed or CORS mismatch.
- Solo AI produces nothing: test clearer solo instrumental recording; do not use the local fallback to claim complete multi-instrument results.
- Too many wrong notes: choose correct mode, reduce sensitivity, use clean stem, compare raw MIDI and quantized MIDI, and manually revise in MuseScore.
- Missing FFmpeg: install FFmpeg and add it to PATH.
- CPU/RAM runs out with Demucs/Piano: use a bigger server or GPU, shorten recording; model files are **not bundled** in the ZIP.
- Unsupported library versions: use Python **3.11**, create a clean virtual environment and install compatible PyTorch / TensorFlow runtimes for your OS.

### Third-party tools

Spotify Basic Pitch: https://github.com/spotify/basic-pitch

Demucs: https://github.com/facebookresearch/demucs (upstream archived)

Piano transcription model: https://github.com/qiuqiangkong/piano_transcription_inference

MuseScore: https://musescore.org/
