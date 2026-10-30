"""Write a MuseScore-compatible MusicXML score without external notation packages.

All timings are in MIDI ticks (480 ticks per quarter note).  Notes that span
bar lines or need several note values are split and tied, not truncated.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET

TICKS = 480
PITCH_CLASSES = [
    ("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0),
    ("F", 0), ("F", 1), ("G", 0), ("G", 1), ("A", 0),
    ("A", 1), ("B", 0),
]
DURATIONS = [
    (1920, "whole", False), (1440, "half", True),
    (960, "half", False), (720, "quarter", True),
    (480, "quarter", False), (360, "eighth", True),
    (240, "eighth", False), (180, "16th", True),
    (120, "16th", False), (90, "32nd", True),
    (60, "32nd", False), (30, "64th", False),
]


@dataclass(frozen=True)
class NoteEvent:
    start: int
    end: int
    pitch: int
    velocity: int = 85


@dataclass
class Track:
    name: str
    notes: list[NoteEvent]
    program: int = 0  # MIDI 0-based General MIDI instrument program
    percussion: bool = False


def sec_to_ticks(seconds: float, tempo: int, subdivision: int = 4) -> int:
    """subdivision=4 -> 16th-note grid, =2 -> 8th-note grid."""
    grid = TICKS // subdivision
    return max(0, round(float(seconds) * tempo / 60 * TICKS / grid) * grid)


def quantize_events(raw_notes, bpm: int, subdivision: int = 4) -> list[NoteEvent]:
    result = []
    for n in raw_notes:
        # Basic Pitch emits (start_sec, end_sec, midi_pitch, amplitude, pitch_bends).
        start, end, midi_pitch = n[:3]
        strength = float(n[3]) if len(n) > 3 else 0.75
        pitch = int(midi_pitch)
        if not 0 <= pitch <= 127 or not math.isfinite(start) or not math.isfinite(end):
            continue
        s = sec_to_ticks(start, bpm, subdivision)
        e = max(s + TICKS // subdivision, sec_to_ticks(end, bpm, subdivision))
        velocity = max(30, min(127, round(strength * 127)))
        result.append(NoteEvent(s, e, pitch, velocity))
    # Duplicate detections produce unhelpful notation; retain strongest.
    best: dict[tuple[int, int, int], NoteEvent] = {}
    for n in result:
        k = (n.start, n.end, n.pitch)
        if k not in best or n.velocity > best[k].velocity:
            best[k] = n
    return sorted(best.values(), key=lambda n: (n.start, n.end, n.pitch))


def _tag(parent, name, value=None, **attrs):
    el = ET.SubElement(parent, name, attrs)
    if value is not None:
        el.text = str(value)
    return el


def _single_pitch(parent, pitch: int, percussion=False):
    if percussion:
        # Standard staff positions: bass drum bottom, snare middle, hi-hat top.
        positions = {36: ("F", 4), 38: ("C", 5), 42: ("G", 5)}
        step, octave = positions.get(pitch, ("C", 5))
        pitch_el = _tag(parent, "unpitched")
        _tag(pitch_el, "display-step", step)
        _tag(pitch_el, "display-octave", octave)
    else:
        step, alteration = PITCH_CLASSES[pitch % 12]
        p = _tag(parent, "pitch")
        _tag(p, "step", step)
        if alteration:
            _tag(p, "alter", alteration)
        _tag(p, "octave", pitch // 12 - 1)


def _duration_pieces(duration: int) -> list[tuple[int, str, bool]]:
    chunks = []
    remain = duration
    for size, name, dotted in DURATIONS:
        while remain >= size:
            chunks.append((size, name, dotted))
            remain -= size
    if remain:
        raise ValueError("Duration is not divisible by 30 ticks")
    return chunks


def _append_note(measure, *, pitch, duration, note_type, dotted, voice,
                 percussion, chord=False, tie_start=False, tie_stop=False, rest=False):
    n = _tag(measure, "note")
    if chord:
        _tag(n, "chord")
    if rest:
        _tag(n, "rest")
    else:
        _single_pitch(n, pitch, percussion)
    _tag(n, "duration", duration)
    if tie_stop:
        _tag(n, "tie", type="stop")
    if tie_start:
        _tag(n, "tie", type="start")
    _tag(n, "voice", voice)
    _tag(n, "type", note_type)
    if dotted:
        _tag(n, "dot")
    if not rest and (tie_start or tie_stop):
        notation = _tag(n, "notations")
        if tie_stop:
            _tag(notation, "tied", type="stop")
        if tie_start:
            _tag(notation, "tied", type="start")
    if percussion and not rest:
        _tag(n, "stem", "up")
    return n


def _make_voices(notes: list[NoteEvent]):
    """Interval partition. Simultaneous equally long notes form one chord."""
    grouped = {}
    for n in notes:
        grouped.setdefault((n.start, n.end), []).append(n)
    chunks = sorted(grouped.items(), key=lambda x: x[0])
    voices = []
    ends = []
    for (start, end), chord in chunks:
        eligible = [i for i, available in enumerate(ends) if available <= start]
        if eligible:
            i = max(eligible, key=lambda j: ends[j])
        else:
            i = len(voices)
            voices.append([])
            ends.append(0)
        voices[i].append((start, end, chord))
        ends[i] = end
    return voices or [[]]


def _write_interval(maps, start, end, voice_id, total_measure, *, chord=None, percussion=False):
    """Place rests/notes in successive measures, preserving ties."""
    cursor = start
    pieces = []
    while cursor < end:
        bar = cursor // total_measure
        until_bar = min(end, (bar + 1) * total_measure)
        for dur, note_type, dotted in _duration_pieces(until_bar - cursor):
            pieces.append((bar, dur, note_type, dotted))
            cursor += dur
    for i, (bar, dur, note_type, dotted) in enumerate(pieces):
        for j, entry in enumerate(chord or [None]):
            _append_note(
                maps[bar], pitch=entry.pitch if entry else 60,
                duration=dur, note_type=note_type, dotted=dotted,
                voice=voice_id, percussion=percussion,
                chord=j > 0, tie_stop=bool(chord and i > 0),
                tie_start=bool(chord and i < len(pieces) - 1),
                rest=chord is None,
            )


def write_musicxml(path: Path, title: str, bpm: int, time_signature: str, tracks: list[Track]):
    beats, beat_type = map(int, time_signature.split("/"))
    if TICKS * beats * 4 % beat_type:
        raise ValueError("Unsupported time signature")
    bar_ticks = TICKS * beats * 4 // beat_type
    longest = max((n.end for t in tracks for n in t.notes), default=bar_ticks)
    bar_count = max(1, math.ceil(longest / bar_ticks))
    root = ET.Element("score-partwise", version="4.0")
    work = _tag(root, "work")
    _tag(work, "work-title", title)
    _tag(root, "movement-title", title)
    ident = _tag(root, "identification")
    _tag(ident, "creator", "APVINIX AI — transkripsi otomatis (perlu verifikasi)", type="composer")
    listing = _tag(root, "part-list")

    for ix, track in enumerate(tracks, 1):
        code = f"P{ix}"
        listing_part = _tag(listing, "score-part", id=code)
        _tag(listing_part, "part-name", track.name)
        instr_code = f"I{ix}"
        si = _tag(listing_part, "score-instrument", id=instr_code)
        _tag(si, "instrument-name", "Percussion" if track.percussion else track.name)
        mi = _tag(listing_part, "midi-instrument", id=instr_code)
        channel = 10 if track.percussion else (ix if ix < 10 else min(ix + 1, 16))
        _tag(mi, "midi-channel", channel)
        _tag(mi, "midi-program", max(1, min(128, track.program + 1)))
        part = _tag(root, "part", id=code)
        measures = [_tag(part, "measure", number=str(j+1)) for j in range(bar_count)]
        attrs = _tag(measures[0], "attributes")
        _tag(attrs, "divisions", TICKS)
        key = _tag(attrs, "key")
        _tag(key, "fifths", 0)
        ts = _tag(attrs, "time")
        _tag(ts, "beats", beats)
        _tag(ts, "beat-type", beat_type)
        clef = _tag(attrs, "clef")
        _tag(clef, "sign", "percussion" if track.percussion else ("F" if track.program == 32 else "G"))
        if not track.percussion:
            _tag(clef, "line", 4 if track.program == 32 else 2)
        if ix == 1:
            direction = _tag(measures[0], "direction", placement="above")
            dtype = _tag(direction, "direction-type")
            metronome = _tag(dtype, "metronome")
            _tag(metronome, "beat-unit", "quarter")
            _tag(metronome, "per-minute", bpm)
            _tag(direction, "sound", tempo=str(bpm))

        voices = _make_voices(track.notes)
        for voice_i, events in enumerate(voices, 1):
            if voice_i > 1:
                for m in measures:
                    backup = _tag(m, "backup")
                    _tag(backup, "duration", bar_ticks)
            pos = 0
            for start, end, chord in events:
                if start > pos:
                    _write_interval(measures, pos, start, voice_i, bar_ticks)
                _write_interval(measures, start, end, voice_i, bar_ticks,
                                chord=chord, percussion=track.percussion)
                pos = end
            if pos < bar_count * bar_ticks:
                _write_interval(measures, pos, bar_count * bar_ticks, voice_i, bar_ticks)
        for m in measures:
            _tag(m, "barline", location="right") if m is measures[-1] else None

    ET.indent(root, space="  ")
    output = ET.ElementTree(root)
    output.write(path, encoding="utf-8", xml_declaration=True)
    return {"measures": bar_count, "parts": len(tracks), "notes": sum(len(t.notes) for t in tracks)}
