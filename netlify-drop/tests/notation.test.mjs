import test from 'node:test';
import assert from 'node:assert/strict';
import {quantize,musicXML,midiBytes} from '../js/notation.js';
import {detectMelody} from '../js/detect.js';

test('notes quantized on 16th-note grid',()=>{
 const notes=quantize([{startTimeSeconds:0.13,durationSeconds:0.39,pitchMidi:69,amplitude:.8}],120,4);
 assert.equal(notes[0].start,120);assert.equal(notes[0].end,480);
});
test('MusicXML contains title, measure, and pitched note',()=>{
 const notes=quantize([{startTimeSeconds:0,durationSeconds:.5,pitchMidi:60,amplitude:.8}],120,4);
 const xml=musicXML(notes,{title:'Test & Hello',bpm:120,meter:'4/4'});
 assert.match(xml,/Test &amp; Hello/);assert.match(xml,/<measure number="1">/);assert.match(xml,/<step>C<\/step>/);assert.match(xml,/<octave>4<\/octave>/);
});
test('MusicXML splits across measure with ties',()=>{
 const notes=[{start:1680,end:2400,pitch:64,velocity:100}];const xml=musicXML(notes,{title:'Cross Bar',bpm:120});
 assert.match(xml,/<measure number="2">/);assert.match(xml,/<tie type="start"\/>/);assert.match(xml,/<tie type="stop"\/>/);
});
test('MusicXML uses backup for simultaneous polyphonic voices',()=>{
 const notes=[{start:0,end:960,pitch:60,velocity:100},{start:0,end:480,pitch:65,velocity:90}];const xml=musicXML(notes);assert.match(xml,/<backup><duration>1920<\/duration><\/backup>/);
});
test('MIDI includes valid MThd and MTrk track chunks',()=>{
 const bytes=midiBytes([{start:0,end:480,pitch:69,velocity:100}],120); const str=Buffer.from(bytes).toString('latin1');
 assert.equal(str.substring(0,4),'MThd');assert.equal(str.substring(14,18),'MTrk');assert.ok(str.endsWith('\x00\xff\x2f\x00'));
});
test('offline fallback identifies synthesized 440Hz pitch',()=>{
 const length=22050*2,samples=new Float32Array(length);
 for(let i=0;i<length;i++)samples[i]=.35*Math.sin(2*Math.PI*440*i/22050);
 const notes=detectMelody(samples);
 assert.ok(notes.length>0,'should find at least one note');assert.ok(notes.some(n=>n.pitchMidi===69),`detected: ${JSON.stringify(notes)}`);
});
