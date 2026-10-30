import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowDownToLine,ArrowRight,AudioLines,BookOpen,Check,CheckCircle2,ChevronDown,Cloud,CloudOff,Code2,Disc3,Download,FileAudio,FileCode2,FileMusic,FileUp,Gauge,Headphones,Info,Layers3,Menu,Mic2,Music2,Pause,Play,Plus,RefreshCw,Settings2,ShieldCheck,Sparkles,Trash2,UploadCloud,Volume2,Activity,Wifi,WifiOff,X,Zap} from 'lucide-react';
import {decodeAudio,demoAudio,durationLabel,midiName} from './lib/audio';
import {analyzeLocal} from './lib/worker-client';
import {downloadFile,midiBytes,musicXML,previewSVG,quantize} from './lib/export';
import type {QNote,AnalysisResult,BackendJob} from './lib/types';

const safeTitle=(text:string)=>text.replace(/\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i,'').slice(0,100);
const fmtSize=(n:number)=>n<1024*1024?`${(n/1024).toFixed(0)} KB`:`${(n/1024/1024).toFixed(2)} MB`;
const baseUrl=(s:string)=>s.trim().replace(/\/+$/,'');
const sidemenu=[{id:'studio',name:'Studio Transkripsi',icon:AudioLines},{id:'library',name:'Proyek Terakhir',icon:Layers3},{id:'help',name:'Cara Kerja',icon:BookOpen}];

type HistoryItem={name:string;notes:number;engine:string;date:string};
function App(){
  const [page,setPage]=useState('studio');
  const [file,setFile]=useState<File|null>(null);
  const [fileUrl,setFileUrl]=useState('');
  const [title,setTitle]=useState('');
  const [mode,setMode]=useState<'local'|'studio'>('local');
  const [studioEngine,setStudioEngine]=useState<'solo'|'studio'|'piano'>('studio');
  const [bpm,setBpm]=useState(120);
  const [meter,setMeter]=useState('4/4');
  const [autoBpm,setAutoBpm]=useState(true);
  const [sensitivity,setSensitivity]=useState(0.55);
  const [result,setResult]=useState<AnalysisResult|null>(null);
  const [remoteId,setRemoteId]=useState('');
  const [busy,setBusy]=useState(false);
  const [pct,setPct]=useState(0);
  const [stage,setStage]=useState('');
  const [error,setError]=useState('');
  const [drag,setDrag]=useState(false);
  const [playing,setPlaying]=useState(false);
  const [panel,setPanel]=useState<'score'|'notes'>('score');
  const [api,setApi]=useState(()=>localStorage.getItem('apvinix_api')||import.meta.env.VITE_API_URL||'');
  const [apiHealth,setApiHealth]=useState<'unknown'|'checking'|'online'|'offline'>('unknown');
  const [apiConfig,setApiConfig]=useState(false);
  const [history,setHistory]=useState<HistoryItem[]>(()=>{try{return JSON.parse(localStorage.getItem('apvinix_history')||'[]')}catch{return []}});
  const [mobileMenu,setMobileMenu]=useState(false);
  const [selectedTrack,setSelectedTrack]=useState(0);
  const [quality,setQuality]=useState<{status:string;notice:string;warnings:string[];spectral?:{fraction_supported:number|null;checked:number}}|null>(null);
  const [tracks,setTracks]=useState<{name:string;notes:QNote[];percussion?:boolean}[]>([]);
  const fileInput=useRef<HTMLInputElement>(null);
  const playerRef=useRef<HTMLAudioElement>(null);
  const audioContextRef=useRef<AudioContext|null>(null);
  const timerRef=useRef<number|undefined>(undefined);
  const alive=useRef(true);
  useEffect(()=>()=>{alive.current=false;audioContextRef.current?.close();if(timerRef.current)window.clearInterval(timerRef.current)},[]);
  useEffect(()=>{if(!file)return;const url=URL.createObjectURL(file);setFileUrl(url);return()=>URL.revokeObjectURL(url)},[file]);
  useEffect(()=>{localStorage.setItem('apvinix_api',api)},[api]);
  useEffect(()=>{localStorage.setItem('apvinix_history',JSON.stringify(history.slice(0,10)))},[history]);
  useEffect(()=>{if(mode==='studio'&&apiHealth==='unknown'&&api)void checkServer()},[mode,api]);

  async function checkServer(){
    setApiHealth('checking');
    const controller=new AbortController();const timer=window.setTimeout(()=>controller.abort(),9000);
    try{
      const res=await fetch(`${baseUrl(api)}/api/health`,{signal:controller.signal});
      const data=await res.json();setApiHealth(res.ok&&data.ok?'online':'offline');
    }catch{setApiHealth('offline')}finally{window.clearTimeout(timer)}
  }
  function pick(f?:File){
    if(!f)return;
    const valid=/\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i.test(f.name)||f.type.startsWith('audio/');
    if(!valid){setError('Pilih file audio MP3, WAV, M4A, FLAC, OGG, AAC, atau OPUS.');return}
    if(f.size>60*1024*1024){setError('File terlalu besar. Batas unggah 60 MB.');return}
    setError('');setFile(f);setTitle(safeTitle(f.name));setResult(null);setTracks([]);setQuality(null);setRemoteId('');setPct(0);setStage('');setPage('studio');
  }
  function clear(){setFile(null);setResult(null);setTracks([]);setQuality(null);setRemoteId('');setBusy(false);setPct(0);setStage('');setTitle('');setPlaying(false)}
  async function loadDemo(){try{pick(await demoAudio())}catch(e){setError(String(e))}}
  function recordHistory(r:AnalysisResult){setHistory(items=>[{name:r.title,notes:r.notes.length,engine:r.source==='studio'?'Studio AI':'Local engine',date:new Date().toLocaleDateString('id-ID')},...items].slice(0,10))}

  async function runLocal(){
    if(!file)return;
    setBusy(true);setError('');setPct(4);setStage('Mendekode audio di browser…');
    try{
      const decoded=await decodeAudio(file);setPct(20);setStage('Menemukan frekuensi dan nada dominan…');
      const raw=await analyzeLocal(decoded.samples,p=>{if(alive.current)setPct(20+Math.round(p*0.7))});
      if(!raw.length)throw new Error('Tidak ada nada yang terdeteksi. Gunakan audio melodi tunggal yang lebih jernih atau pilih Studio AI.');
      const notes=quantize(raw,bpm,4) as QNote[];
      if(!notes.length)throw new Error('Tidak ada not yang bisa diekspor.');
      const r:AnalysisResult={notes,bpm,title:title||'Partitur APVINIX',meter,source:'local',duration:decoded.duration};
      setTracks([{name:'Melodi terdeteksi',notes}]);setSelectedTrack(0);setResult(r);recordHistory(r);setPct(100);setStage('Selesai — partitur siap diunduh');
    }catch(e){setError(e instanceof Error?e.message:String(e));setPct(0)}finally{setBusy(false)}
  }
  async function runStudio(){
    if(!file)return;
    if(!api){setApiConfig(true);setError('Isi URL backend AI lebih dahulu. Frontend Netlify saja tidak bisa menjalankan Demucs/Basic Pitch Python.');return}
    setBusy(true);setError('');setStage('Mengunggah audio ke backend AI…');setPct(5);
    const controller=new AbortController();
    try{
      const form=new FormData();
      form.append('file',file);form.append('title',title||'Partitur APVINIX');form.append('mode',studioEngine);form.append('time_signature',meter);form.append('tempo_mode',autoBpm?'auto':'manual');form.append('bpm',String(bpm));form.append('sensitivity',String(sensitivity));form.append('subdivision','4');
      const upload=await fetch(`${baseUrl(api)}/api/transcribe`,{method:'POST',body:form,signal:controller.signal});
      if(!upload.ok)throw new Error((await upload.text()).slice(0,300)||`Gagal mengunggah (${upload.status})`);
      const job:BackendJob=await upload.json();setRemoteId(job.id);
      // Poll. The heavy AI job takes more time than a serverless request.
      let finished=false;
      for(let i=0;i<480;i++){
        await new Promise(ok=>setTimeout(ok,2000));
        const statusRes=await fetch(`${baseUrl(api)}/api/jobs/${job.id}`,{signal:controller.signal});
        if(!statusRes.ok)throw new Error('Gagal membaca status AI. Server mungkin telah dimulai ulang.');
        const status:BackendJob=await statusRes.json();
        setStage(status.stage);setPct(Math.round(status.progress));
        if(status.state==='error')throw new Error(status.stage||'Proses AI gagal');
        if(status.state==='done'){finished=true;break}
      }
      if(!finished)throw new Error('Analisis melewati batas waktu. Coba audio yang lebih pendek.');
      const notesRes=await fetch(`${baseUrl(api)}/api/jobs/${job.id}/notes`,{signal:controller.signal});
      if(!notesRes.ok)throw new Error('Konversi selesai, tetapi data pratinjau gagal diambil. File hasil mungkin tetap dapat diunduh.');
      const data:{bpm:number;meter:string;title:string;quality?:{status:string;notice:string;warnings:string[];spectral?:{fraction_supported:number|null;checked:number}};tracks:{name:string;percussion:boolean;notes:QNote[]}[]} = await notesRes.json();
      setBpm(data.bpm);setTracks(data.tracks);setQuality(data.quality||null);setSelectedTrack(0);
      const all=data.tracks.flatMap(t=>t.notes);
      const r:AnalysisResult={notes:all,bpm:data.bpm,meter:data.meter,title:data.title,source:'studio',tracks:data.tracks.map(t=>({name:t.name,count:t.notes.length}))};
      setResult(r);recordHistory(r);setPct(100);
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  const trackNotes=tracks[selectedTrack]?.notes||result?.notes||[];
  const preview=useMemo(()=>result?previewSVG(trackNotes.slice(0,72),{title:result.title,bpm:result.bpm}):'',[result,tracks,selectedTrack]);
  const totalNotes=tracks.reduce((s,t)=>s+t.notes.length,0);
  function updateNote(i:number,delta:number){
    if(!result)return;
    setTracks(old=>old.map((t,index)=>index===selectedTrack?{...t,notes:t.notes.map((n,j)=>j===i?{...n,pitch:Math.max(21,Math.min(108,n.pitch+delta))}:n)}:t));
  }
  function downloadLocal(which:'xml'|'midi'){
    if(!result)return;
    const selected=result.source==='local'?result.notes:trackNotes;
    const fname=(result.title.replace(/[^a-z\d _-]/gi,'').replace(/\s+/g,'-').slice(0,60)||'APVINIX');
    if(which==='xml')downloadFile(musicXML(selected,{title:result.title,bpm:result.bpm,meter:result.meter}),fname+'.musicxml','application/vnd.recordare.musicxml+xml');
    else downloadFile(midiBytes(selected,result.bpm),fname+'.mid','audio/midi');
  }
  async function downloadRemote(format:'musicxml'|'midi'|'mxl'|'zip'|'raw_midi'|'quality'){
    if(!remoteId)return;
    try{
      const res=await fetch(`${baseUrl(api)}/api/jobs/${remoteId}/download/${format}`);
      if(!res.ok)throw new Error('Unduhan gagal. Pastikan backend masih menyimpan file hasil.');
      const bytes=await res.blob();downloadFile(bytes,`APVINIX-${(result?.title||'partitur').replace(/[^\w-]/g,'_')}.${format==='musicxml'?'musicxml':format==='midi'||format==='raw_midi'?'mid':format==='quality'?'json':format}` ,bytes.type||'application/octet-stream');
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  function synth(){
    if(!result)return;
    if(playing){void audioContextRef.current?.close();audioContextRef.current=null;setPlaying(false);return}
    const ctx=new AudioContext();audioContextRef.current=ctx;setPlaying(true);
    const noteList=trackNotes.slice(0,240);
    if(!noteList.length){setPlaying(false);return}
    const maxTime=Math.min(40,Math.max(...noteList.map(n=>n.end))*60/result.bpm/480);
    for(const n of noteList){
      const start=ctx.currentTime+0.08+n.start*60/result.bpm/480;
      if(start-ctx.currentTime>40)break;
      const length=Math.max(0.07,(n.end-n.start)*60/result.bpm/480);
      const o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.value=440*Math.pow(2,(n.pitch-69)/12);
      g.gain.setValueAtTime(0,start);g.gain.linearRampToValueAtTime(0.09,start+0.015);g.gain.exponentialRampToValueAtTime(0.001,start+length);
      o.connect(g).connect(ctx.destination);o.start(start);o.stop(start+length+0.04);
    }
    window.setTimeout(()=>{if(audioContextRef.current===ctx){void ctx.close();audioContextRef.current=null;setPlaying(false)}},Math.ceil((maxTime+0.5)*1000));
  }
  const recording=result?.source==='studio' ? 'Studio AI' : 'Mode lokal';
  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu?'is-open':''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={26}/></div><div><div className="brand-title">APVINIX <b>AI</b></div><div className="brand-subtitle">MUSIC INTELLIGENCE</div></div></div>
      <div className="side-section-label">WORKSPACE</div>
      <nav className="side-nav">{sidemenu.map(({id,name,icon:Icon})=><button key={id} className={`nav-link ${page===id?'active':''}`} onClick={()=>{setPage(id);setMobileMenu(false)}}><Icon size={18}/>{name}{id==='studio'&&<span className="nav-dot"/>}</button>)}</nav>
      <div className="side-section-label library-label">PROJECT STATUS</div>
      <div className="server-tile"><div className="server-label"><span className="status-led"/> Engine lokal siap</div><div className="server-detail">Pemrosesan langsung di browser</div></div>
      <div className="server-tile secondary-tile"><div className="server-label"><span className={`status-led ${apiHealth==='online'?'':'muted'}`}/> Studio AI {apiHealth==='online'?'terhubung':'opsional'}</div><div className="server-detail">Basic Pitch · Python · Demucs</div></div>
      <div className="sidebar-bottom"><div className="avatar">A</div><div><strong>APVINIX Studio</strong><small>Audio to MusicXML</small></div><Settings2 size={17} onClick={()=>setApiConfig(true)} role="button" tabIndex={0}/></div>
    </aside>
    {mobileMenu&&<div className="mobile-shade" onClick={()=>setMobileMenu(false)}/>}
    <main className="workspace">
      <header className="topbar"><div className="breadcrumbs"><button className="mobile-toggle" onClick={()=>setMobileMenu(true)} aria-label="Buka menu"><Menu size={22}/></button><span>Workspace</span><span className="crumb-separator">/</span><strong>{page==='studio'?'Studio Transkripsi':page==='library'?'Proyek Terakhir':'Panduan'}</strong></div><div className="top-right"><span className="build-label"><span className="green-dot"/> SYSTEM READY</span><button className="icon-button" title="Konfigurasi AI" onClick={()=>setApiConfig(true)}><Settings2 size={19}/></button></div></header>
      <div className="main-content">
        {page==='studio'&&<>
          <section className="hero"><div className="hero-copy"><div className="hero-eyebrow"><Sparkles size={13}/> THE NEXT GENERATION OF MUSIC TRANSCRIPTION</div><h1>Every sound,<br/><span>becomes a score.</span></h1><p>Ubah audio menjadi not balok yang dapat dibuka di MuseScore. Dari melodi sederhana hingga analisis multi-instrumen dengan backend AI.</p><div className="hero-stats"><div><strong>MusicXML</strong><span>MuseScore ready</span></div><div className="hero-stat-line"/><div><strong>MIDI</strong><span>Playable notes</span></div><div className="hero-stat-line"/><div><strong>AI Studio</strong><span>Multi-track option</span></div></div></div><div className="hero-graphic"><div className="orb orb-one"/><div className="orb orb-two"/><div className="music-window"><div className="window-top"><i/><i/><i/><span>score_preview.musicxml</span></div><div className="score-lines">{[0,1,2,3,4].map(j=><div key={j} className="staff-line"/>)}<span className="clef">𝄞</span>{[1,2,3,4,5,6].map((i)=><span key={i} className="decor-note" style={{left:`${13+i*13}%`,top:`${24+(i%3)*13}%`}}>♪</span>)}</div><div className="window-caption"><CheckCircle2 size={14}/> Score generated successfully</div></div></div></section>
          <section className="studio-columns">
            <div className="left-column">
              <div className="section-heading"><div><div className="section-kicker">01 / SOURCE</div><h2>Audio Input</h2></div><span className="step-chip">STEP 01</span></div>
              {!file?<div className={`dropzone ${drag?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);pick(e.dataTransfer.files[0])}} onClick={()=>fileInput.current?.click()} tabIndex={0} role="button" onKeyDown={e=>{if(e.key==='Enter')fileInput.current?.click()}}><div className="drop-icon"><FileUp size={28}/></div><h3>Masukkan file audio kamu</h3><p>Drag & drop lagu di sini, atau <u>pilih file</u></p><div className="drop-formats"><span>MP3</span><span>WAV</span><span>FLAC</span><span>M4A</span><span>OGG</span></div><span className="drop-limit">Maks. 60 MB · file tidak disimpan di mode lokal</span></div>:
              <div className="file-loaded"><div className="file-card-heading"><div className="file-square"><FileAudio size={24}/></div><div className="file-meta"><strong>{file.name}</strong><span>{fmtSize(file.size)} · Siap dianalisis</span></div><button className="icon-button" onClick={clear} title="Hapus file"><Trash2 size={18}/></button></div><audio ref={playerRef} src={fileUrl} controls preload="metadata" className="audio-control"/><div className="file-ready"><CheckCircle2 size={15}/> File berhasil dimuat</div></div>}
              <input ref={fileInput} type="file" hidden accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac,.opus" onChange={e=>{pick(e.target.files?.[0]);e.target.value=''}}/>
              <div className="demo-row"><span>Belum punya audio?</span><button onClick={()=>void loadDemo()}><Play size={13}/> Coba melodi demo</button></div>
              <div className="section-heading engine-heading"><div><div className="section-kicker">02 / ENGINE</div><h2>Transcription Engine</h2></div><span className="step-chip">STEP 02</span></div>
              <div className="engine-grid"><button className={`engine-option ${mode==='local'?'selected':''}`} onClick={()=>setMode('local')}><div className="engine-icon local"><Zap size={20}/></div><span className="engine-title">Local Engine <span className="tag-green">READY</span></span><small>Proses melodi dominan di browser. Tanpa server.</small><span className="engine-radio">{mode==='local'&&<Check size={12}/>}</span></button><button className={`engine-option ${mode==='studio'?'selected':''}`} onClick={()=>setMode('studio')}><div className="engine-icon ai"><Sparkles size={20}/></div><span className="engine-title">Studio AI <span className="tag-purple">ADVANCED</span></span><small>Basic Pitch + tempo AI + opsi multi-track.</small><span className="engine-radio">{mode==='studio'&&<Check size={12}/>}</span></button></div>
              {mode==='studio'&&<div className="studio-note"><div className="studio-note-top"><span><Cloud size={16}/> Python AI Backend</span><button onClick={()=>setApiConfig(true)}>{api?'Edit URL':'Sambungkan'} <ArrowRight size={14}/></button></div><p>Mode ini butuh server Python terpisah. Netlify hanya menayangkan frontend.</p><div className={`studio-status ${apiHealth}`}><span className="status-led"/>{apiHealth==='online'?'Terhubung dan siap':apiHealth==='checking'?'Menghubungkan…':apiHealth==='offline'?'Server belum dapat dihubungi':'Belum dikonfigurasi'}</div><label className="form-row full"><span>Jenis analisis audio</span><select value={studioEngine} onChange={e=>setStudioEngine(e.target.value as 'solo'|'studio'|'piano')}><option value="solo">Basic Pitch · instrumen / melodi tunggal</option><option value="studio">Demucs 4 stem · vokal, bass, instrumen lain, drum (perkiraan)</option><option value="piano">Piano AI · model PyTorch khusus piano</option></select></label><p>Model Piano AI harus diinstal terpisah di backend. Pilih berdasarkan instrumen asli, bukan keinginan hasil.</p></div>}
              <div className="section-heading settings-heading"><div><div className="section-kicker">03 / CONFIGURATION</div><h2>Pengaturan Partitur</h2></div><Settings2 size={18} className="muted-icon"/></div>
              <div className="settings-card"><label className="form-row full"><span>Judul Partitur</span><input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100} placeholder="Nama komposisi"/></label><div className="form-duo"><label className="form-row"><span>Tempo (BPM)</span><input type="number" min="40" max="220" value={bpm} onChange={e=>setBpm(Math.max(40,Math.min(220,Number(e.target.value)||120)))}/></label><label className="form-row"><span>Birama</span><select value={meter} onChange={e=>setMeter(e.target.value)}><option>4/4</option><option>3/4</option><option>6/8</option></select></label></div>{mode==='studio'&&<><label className="switch-line subtle"><input type="checkbox" checked={autoBpm} onChange={e=>setAutoBpm(e.target.checked)}/><span>Deteksi BPM otomatis dengan librosa</span></label><label className="range-row"><span>Sensitivitas AI <strong>{Math.round(sensitivity*100)}%</strong></span><input type="range" min="0.2" max="0.85" step="0.05" value={sensitivity} onChange={e=>setSensitivity(Number(e.target.value))}/></label></>}</div>
              <button className="convert-btn" disabled={busy||!file} onClick={()=>void(mode==='studio'?runStudio():runLocal())}>{busy?<><RefreshCw className="spinning" size={19}/> Menganalisis lagu…</>:<><Sparkles size={20}/> Ubah Jadi Partitur <ArrowRight size={18}/></>}</button>
              {busy&&<div className="progress-box"><div><span>{stage}</span><strong>{pct}%</strong></div><div className="progress-track"><div style={{width:`${pct}%`}}/></div></div>}
              {error&&<div className="error-box" role="alert"><Info size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Tutup"><X size={16}/></button></div>}
              <p className="security-text"><ShieldCheck size={14}/> Lokal: audio tetap di perangkatmu · Studio: audio dikirim ke server AI yang kamu konfigurasi.</p>
            </div>
            <div className="right-column"><div className="section-heading"><div><div className="section-kicker">04 / OUTPUT</div><h2>Partitur & Hasil</h2></div><span className="step-chip">PREVIEW</span></div>
              {!result?<div className="empty-results"><div className="empty-icon"><Music2 size={39}/></div><div className="empty-wave"><span/><span/><span/><span/><span/><span/><span/><span/><span/></div><h3>Partiturmu akan muncul di sini</h3><p>Upload lagu dan jalankan transkripsi untuk melihat not, tempo, dan unduhan MusicXML.</p><div className="empty-features"><span><FileCode2 size={15}/> MusicXML</span><span><Disc3 size={15}/> MIDI</span><span><Headphones size={15}/> Preview</span></div></div>:
              <div className="result-card"><div className="result-success"><span><CheckCircle2 size={17}/> Transkripsi selesai</span><small>{recording}</small></div><div className="result-title"><strong>{result.title}</strong><span>{totalNotes} not terdeteksi</span></div>{result.source==='studio'&&<div className={`quality-panel ${quality?.status==='review'?'needs-review':''}`}><strong>{quality?.status==='review'?'⚠ PERLU DIVERIFIKASI':'◉ HASIL TRANSKRIPSI SEMENTARA'}</strong><p>{quality?.notice||'Tanpa partitur referensi, akurasi tidak dapat dijamin.'}</p>{quality?.spectral?.fraction_supported!=null&&<p>Dukungan spektral: {Math.round(quality.spectral.fraction_supported*100)}% dari {quality.spectral.checked} not yang dicek (bukan angka akurasi).</p>}{quality?.warnings?.map((w,i)=><p key={i}>• {w}</p>)}</div>}<div className="result-metrics"><div><strong>{result.bpm}</strong><small>BPM</small></div><div><strong>{result.meter}</strong><small>Birama</small></div><div><strong>{tracks.length}</strong><small>Track</small></div></div><div className="tabs"><button className={panel==='score'?'selected':''} onClick={()=>setPanel('score')}>Pratinjau Not Balok</button><button className={panel==='notes'?'selected':''} onClick={()=>setPanel('notes')}>Daftar & Edit Not</button></div>
              {tracks.length>1&&<div className="track-tabs">{tracks.map((tr,index)=><button key={index} className={selectedTrack===index?'on':''} onClick={()=>setSelectedTrack(index)}>{tr.name} ({tr.notes.length})</button>)}</div>}
              {panel==='score'?<div className="score-preview"><div dangerouslySetInnerHTML={{__html:preview}}/><span>Pratinjau visual sederhana · MusicXML adalah file partitur lengkap</span></div>:<div className="notes-list"><div className="notes-header"><span>WAKTU</span><span>NOT</span><span>EDIT PITCH</span></div>{trackNotes.slice(0,48).map((n,i)=><div className="note-row" key={`${i}-${n.start}`}><span>{(n.start*60/result.bpm/480).toFixed(2)}s</span><strong>{midiName(n.pitch)}</strong><div><button onClick={()=>updateNote(i,-1)} title="Turunkan semitone">−</button><button onClick={()=>updateNote(i,1)} title="Naikkan semitone">+</button></div></div>)}{trackNotes.length>48&&<p className="notes-foot">Menampilkan 48 not pertama dari {trackNotes.length} not.</p>}{result.source==='studio'&&<p className="notes-foot">Perubahan not di editor ini belum memperbarui ZIP asli server. Gunakan file sumber untuk mengedit lebih lanjut di MuseScore.</p>}</div>}
              <div className="result-actions"><button className="listen-btn" onClick={synth}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'Stop suara':'Dengarkan not'}</button>{result.source==='studio'&&remoteId?<button className="download-primary" onClick={()=>void downloadRemote('zip')}><Download size={17}/> Download semua (.zip)</button>:<button className="download-primary" onClick={()=>downloadLocal('xml')}><Download size={17}/> Download MusicXML</button>}</div><div className="download-grid"><button onClick={()=>result.source==='studio'&&remoteId?void downloadRemote('musicxml'):downloadLocal('xml')}><FileCode2 size={17}/> MusicXML <ArrowDownToLine size={15}/></button><button onClick={()=>result.source==='studio'&&remoteId?void downloadRemote('midi'):downloadLocal('midi')}><Disc3 size={17}/> MIDI <ArrowDownToLine size={15}/></button>{result.source==='studio'&&remoteId&&<><button onClick={()=>void downloadRemote('mxl')}><FileMusic size={17}/> MXL <ArrowDownToLine size={15}/></button><button onClick={()=>void downloadRemote('raw_midi')}><Disc3 size={17}/> MIDI mentah <ArrowDownToLine size={15}/></button><button onClick={()=>void downloadRemote('quality')}><FileCode2 size={17}/> Laporan kualitas <ArrowDownToLine size={15}/></button></>}</div><div className="result-hint"><Info size={15}/> File MusicXML dapat dibuka melalui File → Open di MuseScore. Hasil deteksi otomatis perlu diperiksa untuk lagu kompleks.</div></div>}
              <div className="how-card"><div className="how-head"><Activity size={18}/><strong>How APVINIX works</strong></div><div className="how-item"><div className="how-num">01</div><div><strong>Audio analysis</strong><span>Deteksi frekuensi nada, onset, dan durasi.</span></div></div><div className="how-item"><div className="how-num">02</div><div><strong>Music intelligence</strong><span>Kuantisasi ritme dan penyusunan notasi.</span></div></div><div className="how-item"><div className="how-num">03</div><div><strong>Export & edit</strong><span>MusicXML / MIDI untuk MuseScore.</span></div></div></div>
            </div>
          </section></>}
          {page==='library'&&<section className="content-page"><div className="section-kicker">YOUR WORKSPACE</div><h1>Riwayat Transkripsi</h1><p>Hanya metadata proyek yang tersimpan di browser. File audio dan hasil transkripsi tidak tersimpan otomatis.</p>{history.length?history.map((h,i)=><div className="history-item" key={i}><div className="history-icon"><Music2 size={19}/></div><div><strong>{h.name}</strong><span>{h.engine} · {h.notes} not · {h.date}</span></div><CheckCircle2 size={19} className="history-check"/></div>):<div className="no-history">Belum ada proyek. Mulai dengan melodi demo.</div>}<button className="back-studio" onClick={()=>setPage('studio')}><Plus size={17}/> Proyek baru</button></section>}
          {page==='help'&&<section className="content-page"><div className="section-kicker">DOCUMENTATION</div><h1>Bagaimana APVINIX AI Bekerja?</h1><p>Website ini memiliki dua mesin yang memiliki kemampuan dan kebutuhan deployment berbeda.</p><div className="help-grid"><div><Zap size={24}/><h3>Local Engine</h3><p>Berjalan langsung di Netlify. Mengambil melodi dominan menggunakan deteksi pitch autocorrelation. Tidak memerlukan akun/server AI, tetapi akan keliru pada rekaman polifonik atau sangat ramai.</p></div><div><Sparkles size={24}/><h3>Studio AI</h3><p>Memerlukan backend Python yang di-host di luar Netlify. Basic Pitch memprediksi not dan onset; librosa membantu estimasi tempo; Demucs opsional memisahkan audio menjadi stem.</p></div><div><FileCode2 size={24}/><h3>MuseScore</h3><p>Unduh .musicxml atau .mxl, buka dari MuseScore, lalu edit not dan simpan sebagai .mscz. File MIDI dapat diputar menggunakan aplikasi MIDI.</p></div><div><ShieldCheck size={24}/><h3>Privasi & Batas</h3><p>Local Engine memproses audio di browser. Studio mengunggah audio ke server yang dikonfigurasi, dan backend menghapus audio sumber setelah pemrosesan. Tidak ada jaminan hasil identik dengan rekaman.</p></div></div><button className="back-studio" onClick={()=>setPage('studio')}><ArrowRight size={17}/> Mulai transkripsi</button></section>}
      </div>
      <footer className="footer"><span>© 2026 APVINIX AI · Music Intelligence Studio</span><span>Built for creators, composers & learners</span></footer>
    </main>
    {apiConfig&&<div className="modal-shade" onClick={()=>setApiConfig(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><div className="section-kicker">AI INFRASTRUCTURE</div><h2>Hubungkan Backend AI</h2></div><button onClick={()=>setApiConfig(false)} className="icon-button"><X size={20}/></button></div><p>Untuk menjalankan Basic Pitch dan Demucs, deploy folder <code>backend/</code> ke server Python (misalnya Render, Railway, atau VPS), lalu masukkan URL HTTPS di sini.</p><label className="form-row"><span>Backend URL</span><input value={api} onChange={e=>{setApi(e.target.value);setApiHealth('unknown')}} placeholder="https://apvinix-api.example.com"/></label><div className="modal-actions"><button className="modal-test" onClick={()=>void checkServer()} disabled={!api||apiHealth==='checking'}>{apiHealth==='checking'?<RefreshCw size={16} className="spinning"/>:<Wifi size={16}/>} Test koneksi</button><button className="modal-save" onClick={()=>{setApiConfig(false);if(api)void checkServer()}}>Simpan URL</button></div><div className="modal-info"><Info size={15}/> Backend harus mengizinkan CORS untuk domain Netlify kamu. Pengaturan disimpan lokal di browser ini.</div></div></div>}
  </div>
}
export default App;
