import {quantize,musicXML,midiBytes,downloadFile,previewSVG} from './notation.js';
import {detectMelody} from './detect.js';
const $ = id=>document.getElementById(id);
const upload=$('audio-file'),dropzone=$('dropzone'),fileName=$('file-name'),player=$('audio-player'),convert=$('convert'),status=$('status'),progress=$('progress'),progressWrap=$('progress-wrap'),result=$('result'),score=$('score'),notecount=$('note-count'),durationText=$('duration-text'),engineUsed=$('engine-used'),statsBpm=$('stats-bpm');
let currentFile=null,currentURL=null,outputNotes=[],outputXML='',outputMIDI=null,outputName='',busy=false,studioJobId='',studioApi='';
$('api-url').value=localStorage.getItem('apvinix_ai_backend')||'';
$('api-url').addEventListener('change',()=>localStorage.setItem('apvinix_ai_backend',$('api-url').value.trim()));
$('mode').addEventListener('change',()=>{$('server-settings').hidden=!$('mode').value.startsWith('studio')});
$('check-api').addEventListener('click',async()=>{
 const url=$('api-url').value.trim().replace(/\/$/,'');
 if(!/^https:\/\//.test(url)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)){$('server-status').textContent='Gunakan HTTPS atau localhost.';return}
 localStorage.setItem('apvinix_ai_backend',url);
 $('server-status').textContent='Menguji koneksi…';
 try{const c=new AbortController();const t=setTimeout(()=>c.abort(),8000);const r=await fetch(`${url}/api/health`,{signal:c.signal});clearTimeout(t);const j=await r.json();if(!r.ok||!j.ok)throw Error('Backend tidak siap');$('server-status').textContent='✓ Backend merespons · '+Object.entries(j.engines_installed||{}).map(([k,v])=>k+': '+(v?'terpasang':'belum')).join(' · ');}
 catch(e){$('server-status').textContent='Tidak terhubung: '+e.message}
});
async function studioTranscribe(file,{mode,title,meter,bpm,onset}){
 const url=$('api-url').value.trim().replace(/\/$/,'');
 if(!/^https:\/\//.test(url)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url))throw Error('Masukkan URL backend HTTPS pada bagian pengaturan server AI.');
 localStorage.setItem('apvinix_ai_backend',url);studioApi=url;
 const data=new FormData();data.append('file',file);data.append('title',title);data.append('mode',mode==='studio-stems'?'studio':mode==='studio-piano'?'piano':'solo');data.append('bpm',String(bpm));data.append('tempo_mode','auto');data.append('time_signature',meter);data.append('sensitivity',String(0.55));data.append('subdivision','4');
 setStatus('Mengunggah audio ke backend APVINIX AI…');setProgress(4);
 const up=await fetch(url+'/api/transcribe',{method:'POST',body:data});
 if(!up.ok)throw Error('Unggah gagal: '+(await up.text()).slice(0,260));
 const job=await up.json();studioJobId=job.id;
 let info;
 for(let i=0;i<600;i++){
  await new Promise(resolve=>setTimeout(resolve,2000));
  const r=await fetch(`${url}/api/jobs/${job.id}`);if(!r.ok)throw Error('Backend tidak dapat membaca status pekerjaan.');
  const status=await r.json();setStatus(status.stage||'Studio AI sedang bekerja…');setProgress(status.progress||6);
  if(status.state==='error')throw Error(status.stage||'Analisis gagal');
  if(status.state==='done'){info=status.info;break}
 }
 if(!info)throw Error('Analisis terlalu lama. Coba unggah audio lebih pendek.');
 const [notesResponse,xmlResponse,midiResponse]=await Promise.all([
  fetch(`${url}/api/jobs/${job.id}/notes`),
  fetch(`${url}/api/jobs/${job.id}/download/musicxml`),
  fetch(`${url}/api/jobs/${job.id}/download/midi`)
 ]);
 if(!notesResponse.ok||!xmlResponse.ok||!midiResponse.ok)throw Error('AI selesai tetapi ada file hasil yang tidak tersedia.');
 const dataNotes=await notesResponse.json();
 const tracks=dataNotes.tracks||[];
 const flat=tracks.flatMap(t=>t.notes||[]);
 outputXML=await xmlResponse.text();outputMIDI=new Uint8Array(await midiResponse.arrayBuffer());
 const xmlError=new DOMParser().parseFromString(outputXML,'application/xml').querySelector('parsererror');if(xmlError)throw Error('MusicXML dari server tidak valid.');
 outputNotes=flat;
 return {notes:flat,bpm:dataNotes.bpm||bpm,seconds:info.duration||0,engine:`Studio AI · ${tracks.length} track`,title:dataNotes.title||title,quality:dataNotes.quality||info.quality};
}
async function downloadStudio(kind){
 if(!studioJobId||!studioApi)return;
 const r=await fetch(`${studioApi}/api/jobs/${studioJobId}/download/${kind}`);
 if(!r.ok){setStatus('Unduhan '+kind+' gagal. Ulangi konversi untuk membuat file baru.','error');return}
 const blob=await r.blob();downloadFile(blob,outputName+'.'+(kind==='mxl'?'mxl':'zip'),blob.type||'application/octet-stream');
}
$('save-mxl').addEventListener('click',()=>downloadStudio('mxl'));
$('save-zip').addEventListener('click',()=>downloadStudio('zip'));

function withTimeout(promise,ms,label){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' tidak merespons, beralih ke opsi lain.')),ms))])}
function qualityPanel(report, engine){
 const element=$('quality-report');element.hidden=false;element.replaceChildren();
 const headline=document.createElement('strong');
 headline.textContent=report?.status==='review'?'⚠ PARTITUR PERLU DIPERIKSA':'◉ HASIL SEMENTARA — BUKAN AKURASI TERJAMIN';
 element.append(headline);
 const intro=document.createElement('p');intro.textContent=report?.notice||'Mode browser belum dapat memverifikasi bahwa not sesuai seluruh instrumen pada lagu.';element.append(intro);
 if(report?.spectral?.fraction_supported!=null){const p=document.createElement('p');p.textContent=`Indikator dukungan spektral: ${Math.round(report.spectral.fraction_supported*100)}% dari ${report.spectral.checked} sampel not (bukan persentase akurasi).`;element.append(p)}
 for(const warning of report?.warnings||[]){const p=document.createElement('p');p.textContent='• '+warning;element.append(p)}
 if(engine?.includes('cadangan')||engine?.includes('lokal')){const p=document.createElement('p');p.textContent='Deteksi melodi lokal tidak cocok untuk menyalin setiap instrumen lagu lengkap.';element.append(p)}
}
function setStatus(message,type='info') {status.textContent=message;status.dataset.kind=type}
function setProgress(value){progressWrap.hidden=false;progress.style.width=`${Math.max(0,Math.min(100,value))}%`;progressWrap.setAttribute('aria-valuenow',String(Math.round(value)))}
function setFile(file){
 if(!file)return;
 if(file.size>60*1024*1024){setStatus('File melebihi 60 MB. Coba kompres atau potong audio terlebih dahulu.','error');return}
 if(!(file.type.startsWith('audio/')||/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(file.name))){setStatus('Pilih file audio MP3, WAV, OGG, FLAC, atau M4A.','error');return}
 currentFile=file;fileName.textContent=`${file.name} (${(file.size/1048576).toFixed(1)} MB)`;$('title').value=file.name.replace(/\.[^.]+$/,'');
 if(currentURL)URL.revokeObjectURL(currentURL);currentURL=URL.createObjectURL(file);player.src=currentURL;player.hidden=false;
 result.hidden=true;$('quality-report').hidden=true;$('studio-downloads').hidden=true;studioJobId='';progressWrap.hidden=true;setStatus('File siap. Klik “Ubah jadi partitur” untuk memulai.');convert.disabled=false;
}
upload.addEventListener('change',()=>setFile(upload.files[0]));
dropzone.addEventListener('dragover',e=>{e.preventDefault();dropzone.classList.add('dragging')});
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('dragging');setFile(e.dataTransfer.files[0])});
$('try-sample').addEventListener('click',async()=>{
 try{const res=await fetch('./assets/contoh_melodi.wav');if(!res.ok)throw new Error('contoh gagal dimuat');const blob=await res.blob();setFile(new File([blob],'Contoh Melodi Orisinal.wav',{type:'audio/wav'}))}catch(e){setStatus('Contoh audio tidak dapat dimuat. '+e.message,'error')}
});
async function decode(file){
 const audio=new (window.AudioContext||window.webkitAudioContext)();
 try{const raw=await file.arrayBuffer();const decoded=await audio.decodeAudioData(raw);const seconds=decoded.duration;
   const targetRate=22050;const offline=new OfflineAudioContext(1,Math.ceil(seconds*targetRate),targetRate);
   const src=offline.createBufferSource();src.buffer=decoded;src.connect(offline.destination);src.start();const rendered=await offline.startRendering();
   return {samples:rendered.getChannelData(0).slice(),seconds};
 }finally{await audio.close()}
}
async function aiNotes(samples){
 setStatus('Mengunduh dan menyiapkan model AI Basic Pitch…');setProgress(9);
 const {BasicPitch,outputToNotesPoly,noteFramesToTime} = await withTimeout(import('https://esm.sh/@spotify/basic-pitch@1.0.1?bundle'),25000,'Library AI');
 const model=new BasicPitch('https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json');
 await withTimeout(model.model,45000,'Model AI');
 const frames=[],onsets=[];
 await model.evaluateModel(samples,(f,o)=>{frames.push(...f);onsets.push(...o)},p=>{setProgress(12+p*75);if(p>0)setStatus(`AI menganalisis suara… ${Math.round(p*100)}%`)});
 if(!frames.length)throw new Error('AI tidak menghasilkan data audio');
 const f=Number($('frame-threshold').value),o=Number($('onset-threshold').value);
 const notes=noteFramesToTime(outputToNotesPoly(frames,onsets,f,o,5));
 if(!notes?.length)throw new Error('AI tidak menemukan not pada audio ini');
 return notes;
}
async function render(xml,notes,bpm,title){
 score.innerHTML=previewSVG(notes,{title,bpm});
 // Optional full MusicXML score renderer. SVG fallback above works without CDN.
 try{
   if(!window.opensheetmusicdisplay){setStatus('Partitur selesai. Mencoba pratinjau MusicXML lengkap…');
     await withTimeout(new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.9.7/build/opensheetmusicdisplay.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('Renderer offline'));document.head.append(s)}),10000,'Pratinjau lengkap')}
   if(window.opensheetmusicdisplay){
     score.innerHTML='';const osmd=new window.opensheetmusicdisplay.OpenSheetMusicDisplay(score,{autoResize:true,drawTitle:true,backend:'svg'});
     await osmd.load(xml);osmd.render();
   }
 }catch(e){score.innerHTML=previewSVG(notes,{title,bpm});}
}
convert.addEventListener('click',async()=>{
 if(busy||!currentFile)return;
 const bpm=Math.max(40,Math.min(240,Number($('bpm').value)||120));const meter=$('meter').value;const mode=$('mode').value;const grid=Number($('grid').value);
 const title=$('title').value.trim()||'Partitur hasil transkripsi';
 const name=title.replace(/[^\p{L}\p{N} ._\-]/gu,'').replace(/\s+/g,'_').slice(0,80)||'APVINIX';
 busy=true;convert.disabled=true;result.hidden=true;setProgress(2);let rawNotes,engine='';
 try{
   if(mode.startsWith('studio')){
     const job=await studioTranscribe(currentFile,{mode,title,meter,bpm,onset:Number($('onset-threshold').value)});
     const name=title.replace(/[^\p{L}\p{N} ._\-]/gu,'').replace(/\s+/g,'_').slice(0,80)||'APVINIX';
     outputName=name;notecount.textContent=String(job.notes.length);durationText.textContent=job.seconds.toFixed(1)+' detik';engineUsed.textContent=job.engine;statsBpm.textContent=String(job.bpm);
     $('studio-downloads').hidden=false;result.hidden=false;setProgress(100);qualityPanel(job.quality,job.engine);
     await render(outputXML,job.notes,job.bpm,job.title);
     setStatus('Studio AI selesai. File MusicXML, MIDI, MXL dan ZIP siap diunduh.','success');
     return;
   }
   studioJobId='';$('studio-downloads').hidden=true;
   setStatus('Membaca dan mengonversi audio ke 22.050 Hz…');
   const {samples,seconds}=await decode(currentFile);setProgress(7);
   durationText.textContent=`${seconds.toFixed(1)} detik`;
   if(mode==='ai'||mode==='auto'){
     try{rawNotes=await aiNotes(samples);engine='Basic Pitch AI'}
     catch(e){if(mode==='ai')throw new Error(`AI gagal: ${e.message}. Pilih mode Otomatis untuk menggunakan metode cadangan.`);
       setStatus(`AI tidak tersedia (${e.message}). Beralih ke deteksi melodi lokal…`,'warn');engine='Deteksi melodi cadangan';}
   }
   if(!rawNotes){engine='Deteksi melodi lokal';if(seconds>120)setStatus('Mode melodi terbatas pada 120 detik pertama, agar browser tidak kehabisan memori.','warn');
     rawNotes=detectMelody(samples,{limitSeconds:120,onProgress:p=>setProgress(10+p*76)});}
   if(!rawNotes.length)throw new Error('Tidak ada nada terdeteksi. Coba audio dengan melodi jelas (piano/gitar tunggal), atau pilih mode AI.');
   const notes=quantize(rawNotes,bpm,grid);if(!notes.length)throw new Error('Not tidak cukup untuk membuat partitur.');
   setStatus('Membuat MusicXML dan MIDI…');setProgress(91);
   const xml=musicXML(notes,{title,bpm,meter});
   const xmlError=new DOMParser().parseFromString(xml,'application/xml').querySelector('parsererror');if(xmlError)throw new Error('MusicXML tidak valid.');
   outputXML=xml;outputMIDI=midiBytes(notes,bpm);outputNotes=notes;outputName=name;
   notecount.textContent=String(notes.length);engineUsed.textContent=engine;statsBpm.textContent=String(bpm);
   result.hidden=false;setProgress(100);qualityPanel(null,engine);setStatus(`Berhasil! ${notes.length} not dikenali dengan ${engine}. Silakan unduh file .musicxml untuk MuseScore.`,'success');
   await render(xml,notes,bpm,title);setStatus(`Selesai — ${notes.length} not. Unduh MusicXML atau MIDI di bawah.`, 'success');
 }catch(err){setStatus('Konversi gagal: '+(err?.message||String(err)),'error');console.error(err);progressWrap.hidden=true}
 finally{busy=false;convert.disabled=false}
});
$('save-xml').addEventListener('click',()=>outputXML&&downloadFile(outputXML,outputName+'.musicxml','application/vnd.recordare.musicxml+xml'));
$('save-midi').addEventListener('click',()=>outputMIDI&&downloadFile(outputMIDI,outputName+'.mid','audio/midi'));
$('save-both').addEventListener('click',()=>{if(outputXML)downloadFile(outputXML,outputName+'.musicxml','application/vnd.recordare.musicxml+xml');if(outputMIDI)setTimeout(()=>downloadFile(outputMIDI,outputName+'.mid','audio/midi'),300)});
