import xml.etree.ElementTree as ET
from musicxml_export import NoteEvent, Track, quantize_events, write_musicxml


def test_quantize():
    notes = quantize_events([(0, .5, 60, .7, None), (.501, 1, 64, .7, None)], 120,4)
    assert notes[0].start == 0
    assert notes[0].end == 480
    assert notes[1].start == 480


def test_xml_single_voice_chord_and_tie(tmp_path):
    destination = tmp_path / 'score.musicxml'
    # C and E chord lasts across barline; an offbeat G becomes a second voice.
    tracks = [Track('Piano', [NoteEvent(0, 2400, 60), NoteEvent(0, 2400, 64),
                               NoteEvent(480, 960, 67), NoteEvent(2520, 2880, 72)])]
    stats = write_musicxml(destination, 'Contoh', 120, '4/4', tracks)
    root = ET.parse(destination).getroot()
    assert stats['measures'] == 2
    assert root.find('.//part-list/score-part/part-name').text == 'Piano'
    assert len(root.findall('.//chord')) > 0
    assert len(root.findall('.//tie')) > 0
    assert len(root.findall('.//backup')) > 0
    assert root.find('.//metronome/per-minute').text == '120'


def test_xml_three_four_with_rests(tmp_path):
    dest = tmp_path / 'three.musicxml'
    write_musicxml(dest, 'Waltz', 100, '3/4', [Track('Melodi', [NoteEvent(480, 720, 69)])])
    root = ET.parse(dest).getroot()
    assert root.find('.//time/beats').text == '3'
    assert root.find('.//time/beat-type').text == '4'
    assert len(root.findall('.//rest')) >= 1


def test_xml_six_eight(tmp_path):
    dest = tmp_path / 'six.musicxml'
    write_musicxml(dest, 'March', 90, '6/8', [Track('Bass', [NoteEvent(0, 1440, 48)], program=32)])
    root = ET.parse(dest).getroot()
    assert root.find('.//clef/sign').text == 'F'
    assert root.find('.//time/beats').text == '6'
    assert root.find('.//time/beat-type').text == '8'


def test_percussion(tmp_path):
    dest = tmp_path / 'drum.musicxml'
    write_musicxml(dest, 'Beat', 120, '4/4', [Track('Drum', [NoteEvent(0, 120, 36),NoteEvent(480, 600, 38)], percussion=True)])
    root = ET.parse(dest).getroot()
    assert root.find('.//clef/sign').text == 'percussion'
    assert root.find('.//unpitched') is not None
