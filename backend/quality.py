"""Conservative, evidence-based review indicators for transcription.

These are NOT accuracy percentages: without a reference score, an application
cannot know whether a transcription matches the recording. The checks flag
output requiring human listening, using spectral support and timing statistics.
"""
from __future__ import annotations
from collections import Counter
from math import isfinite
from pathlib import Path

from musicxml_export import TICKS, Track


def inspect_score(tracks: list[Track], bpm: int, duration: float, *, source: str = 'AI') -> dict:
    """Structural checks independent of expensive ML packages."""
    count = sum(len(t.notes) for t in tracks)
    warnings: list[str] = []
    if not count:
        warnings.append('Tidak ada not. Hasil tidak layak diekspor.')
    if not 35 <= bpm <= 220:
        warnings.append('Tempo di luar rentang umum; periksa BPM secara manual.')
    if duration > 10 and count < max(3, int(duration * 0.15)):
        warnings.append('Sangat sedikit not relatif terhadap durasi lagu. Banyak bagian mungkin terlewat.')
    if count > duration * 18:
        warnings.append('Jumlah not sangat padat; mungkin ada deteksi harmonik/duplikasi.')
    if any(t.percussion for t in tracks):
        warnings.append('Track drum adalah PERKIRAAN onset, belum transkripsi drum AI terlatih.')
    if len(tracks) > 1:
        warnings.append('Pemisahan stem tidak mengidentifikasi seluruh instrumen satu per satu; bunyi dapat saling bocor.')
    per_track = []
    for tr in tracks:
        pitches = [n.pitch for n in tr.notes]
        invalid = sum(n.end <= n.start or n.start < 0 or n.pitch < 0 or n.pitch > 127 for n in tr.notes)
        if invalid:
            warnings.append(f'Track {tr.name} mempunyai {invalid} not tidak valid.')
        duplicates = len(tr.notes) - len({(n.pitch, n.start, n.end) for n in tr.notes})
        if duplicates:
            warnings.append(f'Track {tr.name}: {duplicates} not duplikat.')
        track_seconds = round(max((n.end for n in tr.notes), default=0) / TICKS * 60 / max(bpm,1), 2)
        per_track.append({'name':tr.name, 'notes':len(tr.notes), 'lowest_midi':min(pitches) if pitches else None,
                          'highest_midi':max(pitches) if pitches else None,'until_seconds':track_seconds,
                          'percussion_heuristic':tr.percussion})
    return {'method':'structural-and-spectral-indicators-not-ground-truth', 'origin':source,
            'status':'review' if warnings else 'provisional', 'warnings':warnings,
            'note_count':count, 'duration_seconds':round(duration,2), 'tracks':per_track,
            'notice':'Tidak ada ground-truth partitur untuk lagu ini. Skor indikatif bukan persentase ketepatan.'}


def spectral_evidence(path: Path, tracks: list[Track], bpm: int, max_checked: int = 320) -> dict:
    """Check pitch-class energy at notated times against chroma extracted from audio.

    Fraction supported is a diagnostic only (it is NOT note accuracy). A wrong
    pitch can share a chroma with a harmonic, and quiet notes can be missed.
    """
    import numpy as np
    import librosa
    y, sr = librosa.load(str(path), sr=11025, mono=True, duration=240)
    if len(y) < 1024 or not np.isfinite(y).all() or float(np.max(np.abs(y))) < 1e-5:
        return {'checked':0,'fraction_supported':None,'warning':'Audio hampir hening / tidak dapat diverifikasi.'}
    hop = 512
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop, n_fft=4096)
    if chroma.shape[1] == 0:
        return {'checked':0,'fraction_supported':None,'warning':'Analisis spektral tidak tersedia.'}
    notes = [(n, tr.name) for tr in tracks if not tr.percussion for n in tr.notes]
    if len(notes) > max_checked:
        inds = np.linspace(0,len(notes)-1,max_checked,dtype=int)
        notes = [notes[i] for i in inds]
    supported = 0
    tested = 0
    for n, _ in notes:
        # Center of each note, quantized seconds. Check onsets away from attacks.
        middle = (n.start + n.end) / 2 / TICKS * 60 / bpm
        frame = int(round(middle * sr / hop))
        if frame < 0 or frame >= chroma.shape[1]:
            continue
        col = chroma[:,frame]
        strength = float(col[n.pitch % 12])
        peak = float(col.max())
        if peak < 0.02:
            continue
        tested += 1
        if strength >= max(0.20,peak * 0.32):
            supported += 1
    fraction = round(supported / tested, 3) if tested else None
    return {'checked':tested,'fraction_supported':fraction,
            'warning':('Banyak not memiliki dukungan spektral yang lemah. Dengarkan dan koreksi sebelum memakai partitur.'
                       if fraction is not None and fraction < 0.48 else None),
            'explanation':'Dukungan spektral bukan ketepatan not: harmonik dan instrumen bersamaan dapat menipu indikator.'}


def quality_report(wav: Path, tracks: list[Track], bpm: int, duration: float, source: str) -> dict:
    report = inspect_score(tracks,bpm,duration,source=source)
    try:
        evidence = spectral_evidence(wav, tracks, bpm)
    except Exception as exc:
        evidence = {'checked':0, 'fraction_supported':None,'warning':'Analisis spektral tambahan gagal.'}
    report['spectral'] = evidence
    if evidence.get('warning'):
        report['warnings'].append(evidence['warning'])
    # No 'verified' state without an actual ground-truth comparison.
    report['status'] = 'review' if report['warnings'] else 'provisional'
    return report
