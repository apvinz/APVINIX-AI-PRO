// APVINIX AI: portable, dependency-free MusicXML and Standard MIDI export.
export const TICKS = 480;
const PITCHES = [['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]];
const LENGTHS = [[1920,'whole',false],[1440,'half',true],[960,'half',false],[720,'quarter',true],[480,'quarter',false],[360,'eighth',true],[240,'eighth',false],[120,'16th',false]];
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function quantize(notes,bpm=120,grid=4){
  const step = TICKS / grid;
  const uniq = new Map();
  for(const note of notes){
    if(!Number.isFinite(note.pitchMidi)||!Number.isFinite(note.startTimeSeconds)||!Number.isFinite(note.durationSeconds))continue;
    const pitch = Math.round(note.pitchMidi);
    if(pitch < 21 || pitch > 108) continue;
    const start=Math.max(0,Math.round(note.startTimeSeconds*bpm*TICKS/60/step)*step);
    const end=Math.max(start+step,Math.round((note.startTimeSeconds+note.durationSeconds)*bpm*TICKS/60/step)*step);
    const velocity=Math.max(30,Math.min(127,Math.round((note.amplitude??0.8)*127)));
    const key=`${start}/${end}/${pitch}`;
    if(!uniq.has(key)||uniq.get(key).velocity<velocity)uniq.set(key,{start,end,pitch,velocity});
  }
  return [...uniq.values()].sort((a,b)=>a.start-b.start||a.pitch-b.pitch||a.end-b.end);
}
function chordVoices(notes){
  const groups=new Map();
  for(const n of notes){const key=`${n.start}/${n.end}`; if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n)}
  const chunks=[...groups.values()].sort((a,b)=>a[0].start-b[0].start||a[0].end-b[0].end);
  const voices=[],ends=[];
  for(const chord of chunks){
    const start=chord[0].start,end=chord[0].end;
    let idx=ends.findIndex(e=>e<=start);
    if(idx<0){idx=voices.length;voices.push([]);ends.push(0)}
    voices[idx].push({start,end,chord});ends[idx]=end;
  }
  return voices.length?voices:[[]];
}
function splitDur(dur){let remaining=dur;const pieces=[];
  for(const [length,type,dot] of LENGTHS){while(remaining>=length){pieces.push({length,type,dot});remaining-=length}}
  if(remaining)throw new Error(`Durasi tidak terkuantisasi: ${remaining}`);
  return pieces;
}
function pitchXML(p){const [step,alter]=PITCHES[p%12];return `<pitch><step>${step}</step>${alter?`<alter>${alter}</alter>`:''}<octave>${Math.floor(p/12)-1}</octave></pitch>`}
function eventXML(n,length,type,dot,voice,firstInChord,tieStop,tieStart){
  return `<note>${!firstInChord?'<chord/>':''}${n?pitchXML(n.pitch):'<rest/>'}<duration>${length}</duration>${n&&tieStop?'<tie type="stop"/>':''}${n&&tieStart?'<tie type="start"/>':''}<voice>${voice}</voice><type>${type}</type>${dot?'<dot/>':''}${n&&(tieStart||tieStop)?`<notations>${tieStop?'<tied type="stop"/>':''}${tieStart?'<tied type="start"/>':''}</notations>`:''}</note>`;
}
function writeSpan(measures,from,to,barTicks,voice,chord=null){
  const parts=[];let cursor=from;
  while(cursor<to){const bar=Math.floor(cursor/barTicks),until=Math.min(to,(bar+1)*barTicks);for(const piece of splitDur(until-cursor)){parts.push({bar,...piece});cursor+=piece.length}}
  for(let k=0;k<parts.length;k++){
    const part=parts[k]; const events=chord??[null];
    events.forEach((n,j)=>{measures[part.bar].push(eventXML(n,part.length,part.type,part.dot,voice,j===0,k>0,k<parts.length-1))});
  }
}
export function musicXML(notes,{title='Partitur APVINIX AI',bpm=120,meter='4/4'}={}){
  const [beats,unit]=meter.split('/').map(Number);
  if(!Number.isInteger(beats)||![4,8].includes(unit))throw new Error('Birama tidak valid');
  const barTicks=TICKS*beats*4/unit;
  const barCount=Math.max(1,Math.ceil(Math.max(barTicks,...notes.map(n=>n.end))/barTicks));
  const measures=Array.from({length:barCount},()=>[]);
  const voices=chordVoices(notes);
  voices.forEach((events,index)=>{
    const voice=index+1;
    if(index>0){for(const measure of measures)measure.push(`<backup><duration>${barTicks}</duration></backup>`)}
    let cursor=0;
    for(const {start,end,chord} of events){
      if(start>cursor)writeSpan(measures,cursor,start,barTicks,voice);
      writeSpan(measures,start,end,barTicks,voice,chord);
      cursor=end;
    }
    if(cursor<barCount*barTicks)writeSpan(measures,cursor,barCount*barTicks,barTicks,voice);
  });
  const body=measures.map((events,i)=>{
    const attributes=i===0?`<attributes><divisions>${TICKS}</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>${unit}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`:'';
    return `<measure number="${i+1}">${attributes}${events.join('')}</measure>`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0"><work><work-title>${esc(title)}</work-title></work><movement-title>${esc(title)}</movement-title><identification><creator type="composer">APVINIX AI · transkripsi otomatis, periksa ulang not</creator></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><part-list><score-part id="P1"><part-name>Transkripsi</part-name><part-abbreviation>Pno</part-abbreviation><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
function u16(n){return [(n>>>8)&255,n&255]}
function u32(n){return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]}
function vlq(value){const bytes=[value&0x7f];while((value>>>=7)>0)bytes.unshift((value&0x7f)|0x80);return bytes}
export function midiBytes(notes,bpm=120){
  const micro=Math.round(60000000/bpm);
  const events=[{tick:0,priority:0,bytes:[0xff,0x51,0x03,(micro>>16)&255,(micro>>8)&255,micro&255]},{tick:0,priority:1,bytes:[0xc0,0]}];
  for(const n of notes){events.push({tick:n.start,priority:3,bytes:[0x90,n.pitch,n.velocity]},{tick:n.end,priority:2,bytes:[0x80,n.pitch,0]})}
  events.sort((a,b)=>a.tick-b.tick||a.priority-b.priority||a.bytes[1]-b.bytes[1]);
  let previous=0;const data=[];
  for(const ev of events){data.push(...vlq(ev.tick-previous),...ev.bytes);previous=ev.tick}
  data.push(0,0xff,0x2f,0);
  return new Uint8Array([...'MThd'].map(c=>c.charCodeAt(0)).concat(u32(6),u16(0),u16(1),u16(TICKS),[...'MTrk'].map(c=>c.charCodeAt(0)),u32(data.length),data));
}
export function downloadFile(data,filename,type){
  const blob=new Blob([data],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
export function previewSVG(notes,{title='Pratinjau partitur',bpm=120}={}){
 const sorted=[...notes].sort((a,b)=>a.start-b.start||a.pitch-b.pitch).slice(0,64); const width=1000,groupSize=16,systems=Math.max(1,Math.ceil(sorted.length/groupSize)); const height=systems*130+84;const lines=[];
 lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(title)}"><rect width="100%" height="100%" rx="10" fill="#fff"/><text x="30" y="34" font-size="20" font-family="Georgia,serif" font-weight="bold" fill="#202026">${esc(title)}</text><text x="30" y="57" font-size="12" font-family="sans-serif" fill="#7b8091">${bpm} BPM · cuplikan ${sorted.length} not pertama (file XML memuat semuanya)</text>`);
 for(let row=0;row<systems;row++){
   const y=96+row*130;for(let n=0;n<5;n++)lines.push(`<line x1="32" x2="968" y1="${y+n*11}" y2="${y+n*11}" stroke="#62677c" stroke-width="1"/>`);
   lines.push(`<text x="43" y="${y+38}" font-family="serif" font-size="47" fill="#222633">𝄞</text>`);
   const group=sorted.slice(row*groupSize,(row+1)*groupSize);const usable=870;
   group.forEach((n,i)=>{
     const x=85+(i+0.5)*usable/Math.max(group.length,1);
     const yNote=y+44-(n.pitch-64)*5.5;
     if(yNote<y-2)for(let ly=y-11;ly>=yNote-3;ly-=11)lines.push(`<line x1="${x-13}" x2="${x+13}" y1="${ly}" y2="${ly}" stroke="#4a4c5a"/>`);
     if(yNote>y+46)for(let ly=y+55;ly<=yNote+3;ly+=11)lines.push(`<line x1="${x-13}" x2="${x+13}" y1="${ly}" y2="${ly}" stroke="#4a4c5a"/>`);
     lines.push(`<ellipse cx="${x}" cy="${yNote}" rx="8.6" ry="5.4" fill="#3433ba" transform="rotate(-18 ${x} ${yNote})"/><line x1="${x+7}" x2="${x+7}" y1="${yNote-2}" y2="${yNote-35}" stroke="#3433ba" stroke-width="2"/>`);
   });
 }
 return lines.join('')+'</svg>';
}
