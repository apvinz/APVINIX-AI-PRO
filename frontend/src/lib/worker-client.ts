import type {RawNote} from './types';
export function analyzeLocal(samples:Float32Array,onProgress:(pct:number)=>void):Promise<RawNote[]>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./local-worker.ts',import.meta.url),{type:'module'});
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Waktu analisis terlalu lama. Coba audio lebih pendek.'))},120000);
    worker.onmessage=(event:MessageEvent)=>{
      const d=event.data;
      if(d.type==='progress')onProgress(Math.round(d.progress*100));
      if(d.type==='complete'||d.type==='error'){
        clearTimeout(timeout);worker.terminate();
        if(d.type==='complete')resolve(d.notes);else reject(new Error(d.message));
      }
    };
    worker.onerror=()=>{clearTimeout(timeout);worker.terminate();reject(new Error('Detektor lokal berhenti.'))};
    worker.postMessage({samples},[samples.buffer]);
  });
}
