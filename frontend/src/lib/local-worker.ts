import {detectMelody} from './detect.js';
self.onmessage=(event:MessageEvent<{samples:Float32Array}>)=>{
  try{
    const notes=detectMelody(event.data.samples,{limitSeconds:180,onProgress:(progress)=>self.postMessage({type:'progress',progress})});
    self.postMessage({type:'complete',notes});
  }catch(e){self.postMessage({type:'error',message:e instanceof Error?e.message:String(e)})}
};
