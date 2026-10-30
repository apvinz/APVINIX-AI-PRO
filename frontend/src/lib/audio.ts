import type {RawNote} from './types';
export async function decodeAudio(file:Blob):Promise<{samples:Float32Array;duration:number}> {
  const audioCtx = new AudioContext();
  try {
    const bytes=await file.arrayBuffer();
    const decoded=await audioCtx.decodeAudioData(bytes);
    const duration=decoded.duration;
    if(duration>180) throw new Error('Mode browser memproses maksimal 3 menit. Gunakan Studio AI untuk lagu lebih panjang.');
    const frames=Math.ceil(duration*22050);
    const offline=new OfflineAudioContext(1,frames,22050);
    const source=offline.createBufferSource();
    source.buffer=decoded;
    source.connect(offline.destination);
    source.start();
    const rendered=await offline.startRendering();
    return {samples:rendered.getChannelData(0).slice(),duration};
  } catch(error){
    if(error instanceof Error && error.message.includes('maksimal'))throw error;
    throw new Error('Audio gagal dibaca. Coba WAV/MP3 dengan format yang didukung browser.');
  } finally {await audioCtx.close();}
}
export function demoAudio(): Promise<File> {
  return fetch('/samples/contoh_melodi.wav').then(async res=>{
    if(!res.ok)throw new Error('Audio demo tidak ditemukan.');
    return new File([await res.blob()],'Contoh Melodi APVINIX.wav',{type:'audio/wav'});
  });
}
export function durationLabel(sec:number){const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${m}:${String(s).padStart(2,'0')}`;}
export function midiName(pitch:number){const c=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];return c[(pitch%12+12)%12]+(Math.floor(pitch/12)-1)}
export function rms(samples:Float32Array,from:number,to:number){let n=0,sum=0;for(let i=from;i<to;i+=3){sum+=samples[i]*samples[i];n++}return Math.sqrt(sum/Math.max(1,n))}
export type {RawNote};
