"""Optional piano-specific PyTorch inference. Requires separate installation/model.

Piano transcription should be selected ONLY for recordings dominated by piano.
It cannot turn arbitrary multi-instrument mixes into precise piano music.
"""
from pathlib import Path


def piano_notes(audio_file: Path, output_file: Path):
    try:
        from piano_transcription_inference import PianoTranscription, sample_rate, load_audio
        import pretty_midi
        import torch
    except ImportError as exc:
        raise RuntimeError('Mode Piano AI memerlukan requirements-piano.txt dan model unduhan pertama. ' + str(exc)) from exc
    signal, _ = load_audio(str(audio_file), sr=sample_rate, mono=True)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = PianoTranscription(device=device)
    model.transcribe(signal, str(output_file))
    if not output_file.is_file():
        raise RuntimeError('Model piano tidak menghasilkan MIDI; proses dihentikan tanpa hasil palsu.')
    midi = pretty_midi.PrettyMIDI(str(output_file))
    result = []
    for instrument in midi.instruments:
        if instrument.is_drum:
            continue
        for n in instrument.notes:
            if n.end > n.start:
                result.append((n.start,n.end,n.pitch,max(0.05,min(1,n.velocity / 127)),None))
    if not result:
        raise RuntimeError('Piano AI tidak menemukan not yang dapat ditranskripsi.')
    return result
