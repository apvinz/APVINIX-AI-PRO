"""APVINIX AI: audio -> AI -> multi-part MusicXML + MIDI + MXL."""
from __future__ import annotations

import shutil
import json
import subprocess
import sys
import zipfile
from pathlib import Path

from musicxml_export import Track, NoteEvent, quantize_events, write_musicxml, TICKS
from quality import quality_report

MAX_SECONDS = 360


def ffmpeg_convert(source: Path, dest: Path):
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("FFmpeg belum terpasang. Ikuti petunjuk instalasi FFmpeg di README.")
    # Reject excessively long audio before decoding; also cap decoding time.
    if shutil.which("ffprobe"):
        cp_info = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
            capture_output=True, text=True, timeout=15,
        )
        try:
            if cp_info.returncode == 0 and float(cp_info.stdout.strip()) > MAX_SECONDS:
                raise RuntimeError(f"Maksimal {MAX_SECONDS//60} menit untuk satu konversi. Potong lagunya dahulu.")
        except ValueError:
            pass
    cmd = ["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
           "-i", str(source), "-t", str(MAX_SECONDS + 2), "-ac", "2",
           "-ar", "44100", "-c:a", "pcm_s16le", str(dest)]
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        raise RuntimeError("Konversi audio terlalu lama. Coba unggah audio lebih pendek.")
    if cp.returncode:
        raise RuntimeError("File audio gagal dibaca FFmpeg. Periksa format dan kondisi file.")


def estimate_bpm(path: Path) -> int:
    import librosa
    import numpy as np

    # Low sampling rate and max 180 seconds keep tempo detection relatively light.
    y, sr = librosa.load(str(path), sr=11025, mono=True, duration=180)
    if len(y) < sr:
        return 120
    bpm_array, _ = librosa.beat.beat_track(y=y, sr=sr, trim=True)
    bpm = float(np.asarray(bpm_array).ravel()[0])
    if not np.isfinite(bpm) or bpm < 35:
        return 120
    while bpm > 190:
        bpm /= 2
    while bpm < 55:
        bpm *= 2
    return max(40, min(220, round(bpm)))


def predicted_notes(path: Path, onset: float, frame: float, min_len_ms: int, min_freq=None, max_freq=None):
    try:
        from basic_pitch.inference import predict
    except ImportError as e:
        raise RuntimeError("Paket AI Basic Pitch belum tersedia. Jalankan install.bat dahulu.") from e
    _, _, detected = predict(
        str(path), onset_threshold=onset, frame_threshold=frame,
        minimum_note_length=float(min_len_ms),
        minimum_frequency=min_freq, maximum_frequency=max_freq,
    )
    return detected


def separate(path: Path, workdir: Path, report):
    try:
        import demucs  # noqa: F401
    except ImportError as exc:
        raise RuntimeError("Mode studio membutuhkan Demucs. Jalankan install-studio.bat.") from exc
    report("Memisahkan vokal, bass, drum, dan instrumen lain…", 26)
    cmd = [sys.executable, "-m", "demucs", "-n", "htdemucs", "--out",
           str(workdir / "stems"), str(path)]
    cp = subprocess.run(cmd, cwd=str(workdir), capture_output=True, text=True, timeout=1800)
    if cp.returncode:
        tail = (cp.stderr or cp.stdout or "").strip()[-700:]
        raise RuntimeError("Pemisahan instrumen gagal. " + tail)
    directory = workdir / "stems" / "htdemucs" / path.stem
    if not directory.is_dir():
        raise RuntimeError("Demucs tidak menghasilkan folder stem seperti yang diharapkan.")
    for name in ("vocals", "bass", "other", "drums"):
        if not (directory / f"{name}.wav").exists():
            raise RuntimeError(f"Stem {name} tidak ditemukan.")
    return directory


def percussion_events(drum_file: Path, bpm: int, subdivision: int):
    """Heuristic beat/percussion track; not reliable as a full drum transcription."""
    import librosa
    import numpy as np
    y, sr = librosa.load(str(drum_file), sr=16000, mono=True)
    hop = 256
    frames = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, backtrack=False)
    events = []
    for f in frames:
        at = float(librosa.frames_to_time(f, sr=sr, hop_length=hop))
        start = int(at * sr)
        clip = y[max(0, start-256):min(len(y), start+2048)]
        if len(clip) < 512:
            continue
        spec = abs(np.fft.rfft(clip))
        freqs = np.fft.rfftfreq(len(clip), 1/sr)
        low = float(spec[freqs < 180].sum())
        high = float(spec[freqs > 3000].sum())
        mid = float(spec[(freqs >= 180) & (freqs <= 3000)].sum())
        midi_pitch = 36 if low > mid * 0.75 else (42 if high > mid else 38)
        events.append((at, at + 0.10, midi_pitch, 0.85, None))
    return quantize_events(events, bpm, subdivision)


def export_midi(path: Path, tracks: list[Track], bpm: int):
    import pretty_midi
    midi = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    for tr in tracks:
        instrument = pretty_midi.Instrument(program=tr.program, is_drum=tr.percussion, name=tr.name.replace("—", "-").encode("latin-1", "replace").decode("latin-1"))
        for n in tr.notes:
            start = n.start / TICKS * 60 / bpm
            end = n.end / TICKS * 60 / bpm
            instrument.notes.append(pretty_midi.Note(velocity=n.velocity, pitch=n.pitch,
                                                     start=start, end=end))
        midi.instruments.append(instrument)
    midi.write(str(path))


def export_raw_midi(path: Path, collections: list[tuple[str, int, bool, list]], bpm: int):
    """Unquantized notes let musicians compare the model's timing before grid snapping."""
    import pretty_midi
    midi = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    for name, program, percussion, events in collections:
        inst = pretty_midi.Instrument(program=program, is_drum=percussion, name=name.replace("—", "-").encode("latin-1", "replace").decode("latin-1"))
        for item in events:
            a,b,p = item[:3]
            v = float(item[3]) if len(item)>3 else 0.8
            if 0 <= int(p) <= 127 and float(b)>float(a)>=0:
                inst.notes.append(pretty_midi.Note(pitch=int(p), velocity=max(1,min(127,int(v*127))),
                                                     start=float(a),end=float(b)))
        midi.instruments.append(inst)
    midi.write(str(path))


def validate_exports(xml_path: Path, midi_path: Path, tracks: list[Track]):
    """Reject malformed exports rather than reporting success."""
    import xml.etree.ElementTree as ET
    import pretty_midi
    tree = ET.parse(xml_path)
    parts = tree.findall('./part')
    if len(parts) != len(tracks):
        raise RuntimeError('MusicXML tidak memiliki semua track yang diharapkan.')
    for part in parts:
        if not part.findall('measure'):
            raise RuntimeError('MusicXML kehilangan birama.')
        for note in part.findall('./measure/note'):
            d = note.find('duration')
            if d is None or int(d.text) <= 0:
                raise RuntimeError('Durasi MusicXML tidak valid.')
    midi = pretty_midi.PrettyMIDI(str(midi_path))
    actual = sum(len(inst.notes) for inst in midi.instruments)
    expected = sum(len(t.notes) for t in tracks)
    if actual != expected:
        raise RuntimeError(f'MIDI kehilangan not: {actual}/{expected}.')


def transcribe(source: Path, workdir: Path, options: dict, report):
    """Runs in server worker thread; report(stage, percent) updates job state."""
    import soundfile as sf

    workdir.mkdir(parents=True, exist_ok=True)
    report("Menyiapkan audio…", 9)
    wav = workdir / "audio.wav"
    ffmpeg_convert(source, wav)
    data = sf.info(str(wav))
    if data.duration > MAX_SECONDS:
        raise RuntimeError(f"Maksimal {MAX_SECONDS//60} menit untuk satu konversi. Potong lagunya dahulu.")
    if data.duration < 0.3:
        raise RuntimeError("Audio terlalu pendek untuk ditranskripsi.")

    if options.get("bpm_auto", True):
        report("Mendeteksi tempo lagu…", 16)
        bpm = estimate_bpm(wav)
    else:
        bpm = int(options["bpm"])
    onset = float(options.get("onset_threshold", 0.5))
    frame = float(options.get("frame_threshold", 0.3))
    min_len = int(options.get("min_note_ms", 128))
    subdivision = int(options.get("subdivision", 4))
    mode = options.get("mode", "solo")
    name = options.get("title", "Partitur Transkripsi")
    time_sig = options.get("time_signature", "4/4")

    tracks = []
    raw_collections = []
    if mode == "studio":
        stemdir = separate(wav, workdir, report)
        for label, stem, program, percentage in [
            ("Vokal / Melodi", "vocals", 53, 50),
            ("Bass", "bass", 32, 65),
            ("Instrumen lain", "other", 0, 80),
        ]:
            report("Mendeteksi not: " + label + "…", percentage)
            # Bass frequency constraint helps prevent upper-harmonic false notes.
            lower, upper = (40, 400) if stem == 'bass' else ((65, 1400) if stem == 'vocals' else (65, 3000))
            events = predicted_notes(stemdir / f"{stem}.wav", onset, frame, min_len, lower, upper)
            raw_collections.append((label,program,False,events))
            notes = quantize_events(events, bpm, subdivision)
            if notes:
                tracks.append(Track(label, notes, program=program))
        report("Menganalisis ketukan drum (perkiraan)…", 85)
        drums = percussion_events(stemdir / "drums.wav", bpm, subdivision)
        if drums:
            tracks.append(Track("Drum (perkiraan)", drums, percussion=True))
            raw_collections.append(("Drum (perkiraan)",0,True,[(n.start/TICKS*60/bpm,n.end/TICKS*60/bpm,n.pitch,n.velocity/127,None) for n in drums]))
    elif mode == "piano":
        report("Menganalisis piano dengan model PyTorch khusus…", 50)
        from piano_engine import piano_notes
        events = piano_notes(wav, workdir / "piano-model-raw.mid")
        raw_collections.append(("Piano",0,False,events))
        notes = quantize_events(events, bpm, subdivision)
        if notes:
            # Separate treble and bass to improve readability, but note crossings
            # remain approximate and may require score editing in MuseScore.
            low = [n for n in notes if n.pitch < 60]
            high = [n for n in notes if n.pitch >= 60]
            if high: tracks.append(Track("Piano — tangan kanan (perkiraan)",high,program=0))
            if low: tracks.append(Track("Piano — tangan kiri (perkiraan)",low,program=32))
    else:
        report("AI mendeteksi not dan durasi…", 50)
        events = predicted_notes(wav, onset, frame, min_len)
        raw_collections.append(("Melodi / Instrumen",0,False,events))
        notes = quantize_events(events, bpm, subdivision)
        if notes:
            tracks.append(Track("Melodi / Instrumen", notes, program=0))

    if not tracks:
        raise RuntimeError("Tidak ada not yang terdeteksi. Coba audio instrumental lebih jelas atau turunkan sensitivitas ambang.")
    report("Menyusun birama dan notasi MusicXML…", 90)
    xml_path = workdir / "partitur.musicxml"
    midi_path = workdir / "partitur.mid"
    stats = write_musicxml(xml_path, name, bpm, time_sig, tracks)
    export_midi(midi_path, tracks, bpm)
    validate_exports(xml_path,midi_path,tracks)
    raw_path = workdir / "transkripsi-mentah.mid"
    export_raw_midi(raw_path,raw_collections,bpm)
    report("Memeriksa dukungan not terhadap audio asli…", 95)
    quality = quality_report(wav,tracks,bpm,float(data.duration),source=mode)
    (workdir / "laporan-kualitas.json").write_text(json.dumps(quality,ensure_ascii=False,indent=2),encoding="utf-8")
    # .mxl is compressed MusicXML; MuseScore can open both .mxl and .musicxml.
    mxl_path = workdir / "partitur.mxl"
    container_xml = b'''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'''
    with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/vnd.recordare.musicxml", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container_xml)
        z.write(xml_path, "score.musicxml")
    zip_path = workdir / "hasil-partitur.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for item in (xml_path, midi_path, mxl_path, raw_path, workdir / "laporan-kualitas.json"):
            z.write(item, item.name)
    (workdir / "notes.json").write_text(json.dumps({
        "bpm": bpm, "meter": time_sig, "title": name, "quality": quality,
        "tracks": [{"name": t.name, "percussion": t.percussion, "notes": [
            {"start": n.start, "end": n.end, "pitch": n.pitch, "velocity": n.velocity}
            for n in t.notes]} for t in tracks],
    }, ensure_ascii=False), encoding="utf-8")
    report("Selesai — file siap diunduh!", 100)
    return {"bpm": bpm, "duration": round(float(data.duration), 1), "quality": quality, **stats,
            "track_names": [t.name for t in tracks]}
