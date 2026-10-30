"""Quality gate should flag warnings rather than invent accuracy claims."""
from pathlib import Path
from quality import inspect_score, spectral_evidence
from musicxml_export import Track,NoteEvent

def test_few_notes_flagged():
    tr=[Track('Instrument',[NoteEvent(0,480,60)])]
    report=inspect_score(tr,120,60)
    assert report['status']=='review'
    assert any('terlewat' in w for w in report['warnings'])
    assert 'accuracy' not in report

def test_drum_is_approximate():
    report=inspect_score([Track('Drum',[NoteEvent(0,480,36)],percussion=True)],120,2)
    assert any('PERKIRAAN' in w for w in report['warnings'])

def test_clean_solo_still_provisional():
    notes=[NoteEvent(i*480,(i+1)*480,60+i%5) for i in range(6)]
    report=inspect_score([Track('Piano',notes)],120,3)
    assert report['status']=='provisional'
    assert 'ground-truth' in report['notice']

def test_spectral_evidence_silence(tmp_path):
    import numpy as np, soundfile as sf
    p=tmp_path/'silence.wav'
    sf.write(p,np.zeros(22050),11025)
    out=spectral_evidence(p,[Track('Melody',[NoteEvent(0,480,60)])],120)
    assert out['fraction_supported'] is None

def test_piano_mode_exports(tmp_path,monkeypatch):
    import transcriber
    from math import sin,pi
    import numpy as np, soundfile as sf
    def create_tone(path,duration):
        sr=16000
        sf.write(path,np.asarray([0.2*sin(2*pi*440*i/sr) for i in range(int(sr*duration))]),sr)
    path=tmp_path/'input.wav';create_tone(path,2)
    monkeypatch.setattr('piano_engine.piano_notes',lambda *_args:[(0,.5,55,.8,None),(.5,1.1,72,.8,None)])
    stats=transcriber.transcribe(path,tmp_path,{'title':'Piano','bpm_auto':False,'bpm':120,'mode':'piano','time_signature':'4/4','subdivision':4},lambda *_:None)
    assert stats['parts']==2
    assert stats['notes']==2
    assert (tmp_path/'partitur.musicxml').is_file()
