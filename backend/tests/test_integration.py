"""End-to-end export smoke test without downloading heavyweight AI weights."""
import io
import math
import wave
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest
import pretty_midi
from fastapi.testclient import TestClient

import transcriber
import app as server


def create_tone(path, duration=1.3, rate=16000):
    import struct
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b''.join(struct.pack('<h',int(6000*math.sin(2*math.pi*440*i/rate))) for i in range(int(rate*duration))))


def test_pipeline_generates_all_files(tmp_path,monkeypatch):
    src = tmp_path/'input.wav'
    create_tone(src)
    monkeypatch.setattr(transcriber, 'predicted_notes', lambda *_args,**_kwargs: [
        (0.0,0.49,69,.9,None),(0.49,0.98,72,.8,None)
    ])
    reports = []
    result = transcriber.transcribe(src,tmp_path,{
      'title':'Lagu Uji', 'bpm_auto':False,'bpm':120,'mode':'solo',
      'time_signature':'4/4', 'subdivision':4,
    },lambda stage,pct: reports.append((stage,pct)))
    assert result['notes'] == 2
    assert result['bpm'] == 120
    assert 'quality' in result
    assert result['quality']['notice'].startswith('Tidak ada ground-truth')
    assert reports[-1][1] == 100
    xml = ET.parse(tmp_path/'partitur.musicxml').getroot()
    assert xml.find('.//movement-title').text == 'Lagu Uji'
    midi = pretty_midi.PrettyMIDI(str(tmp_path/'partitur.mid'))
    assert len(midi.instruments[0].notes) == 2
    with zipfile.ZipFile(tmp_path/'partitur.mxl') as z:
        assert z.namelist()[:2] == ['mimetype','META-INF/container.xml']
        assert z.read('score.musicxml').startswith(b'<?xml')
    with zipfile.ZipFile(tmp_path/'hasil-partitur.zip') as z:
        assert set(z.namelist()) == {'partitur.musicxml','partitur.mid','partitur.mxl','transkripsi-mentah.mid','laporan-kualitas.json'}


def test_api_upload_and_download(tmp_path,monkeypatch):
    monkeypatch.setattr(server,'DATA',tmp_path)
    monkeypatch.setattr(transcriber,'predicted_notes',lambda *_args,**_kwargs: [(0,0.6,60,.8,None)])
    wav = tmp_path/'to-upload.wav';create_tone(wav)
    client = TestClient(server.app)
    response = client.post('/api/transcribe',data={'tempo_mode':'manual','bpm':'120'},
                           files={'file':('demo.wav',wav.read_bytes(),'audio/wav')})
    assert response.status_code == 202, response.text
    identifier = response.json()['id']
    status = client.get(f'/api/jobs/{identifier}').json()
    assert status['state'] == 'done',status
    assert client.get(f'/api/jobs/{identifier}/score').status_code == 200
    result=client.get(f'/api/jobs/{identifier}/download/musicxml')
    assert result.status_code == 200
    assert b'<score-partwise' in result.content
    assert client.get(f'/api/jobs/{identifier}/download/raw_midi').status_code == 200
    assert client.get(f'/api/jobs/{identifier}/download/quality').status_code == 200
