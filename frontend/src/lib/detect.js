// Offline monophonic pitch detection fallback. No external scripts, servers or AI models.
// It transcribes the dominant pitched melody; mixed commercial songs remain approximate.
const median=arr=>{const v=[...arr].sort((a,b)=>a-b);return v[Math.floor(v.length/2)]};
function estimatePitch(signal,offset,size=1024){
 let energy=0;const sampleCount=750;
 for(let i=0;i<sampleCount;i++){const v=signal[offset+i]||0;energy+=v*v}
 if(Math.sqrt(energy/sampleCount)<0.012)return null;
 // Absolute normalized autocorrelation. Search 75Hz–1100Hz at 11025Hz.
 const low=10,high=148;const scores=new Float32Array(high+1);let best=-Infinity,bestLag=0;
 for(let lag=low;lag<=high;lag++){
   let ac=0,p1=0,p2=0;
   for(let i=0;i<sampleCount;i+=2){const a=signal[offset+i],b=signal[offset+i+lag];ac+=a*b;p1+=a*a;p2+=b*b}
   const corr=ac/(Math.sqrt(p1*p2)+1e-9);scores[lag]=corr;
   if(corr>best){best=corr;bestLag=lag}
 }
 if(best<0.57)return null;
 // Favor first strong local maximum, reducing octave errors on harmonics.
 for(let lag=low+1;lag<high-1;lag++)if(scores[lag]>0.86*best&&scores[lag]>=scores[lag-1]&&scores[lag]>scores[lag+1]){bestLag=lag;break}
 const p=69+12*Math.log2((11025/bestLag)/440);
 const midi=Math.round(p);
 return midi>=36&&midi<=96?midi:null;
}
/**
 * @param {Float32Array} samples22050
 * @param {{onProgress?: (progress: number) => void, limitSeconds?: number}} [options]
 */
export function detectMelody(samples22050,{onProgress=()=>{},limitSeconds=120}={}){
 const length=Math.min(samples22050.length,Math.round(limitSeconds*22050));
 if(length<22050/8)throw new Error('Audio terlalu pendek untuk dideteksi.');
 const data=new Float32Array(Math.ceil(length/2));for(let i=0;i<data.length;i++)data[i]=samples22050[i*2];
 const frame=1024,hop=256;const frames=[];
 for(let at=0;at+frame<data.length;at+=hop){
   frames.push({t:(at+frame/2)/11025,p:estimatePitch(data,at)});
   if(frames.length%140===0)onProgress(Math.min(0.99,at/data.length));
 }
 if(!frames.length)return [];
 // Stabilize single-frame pitch fluctuations without erasing short valid notes.
 const smoothed=frames.map((it,i)=>{
   const around=frames.slice(Math.max(0,i-1),Math.min(frames.length,i+2)).map(f=>f.p).filter(p=>p!==null);
   return {...it,p:around.length>=2?median(around):it.p};
 });
 const notes=[];let current=null;
 function push(){if(current&&current.length>=4){const start=Math.max(0,current.start-frame/(2*11025)),duration=current.length*hop/11025; if(duration>=0.085)notes.push({startTimeSeconds:start,durationSeconds:duration,pitchMidi:current.p,amplitude:0.82})}}
 for(const f of smoothed){if(f.p===null){push();current=null;continue}if(!current||current.p!==f.p){push();current={start:f.t,p:f.p,length:1}}else current.length++}
 push();onProgress(1);
 // Merge adjacent fragments of identical pitch with tiny silent gaps.
 const merged=[];
 for(const n of notes){const last=merged[merged.length-1];if(last&&last.pitchMidi===n.pitchMidi&&n.startTimeSeconds-(last.startTimeSeconds+last.durationSeconds)<0.075){last.durationSeconds=n.startTimeSeconds+n.durationSeconds-last.startTimeSeconds}else merged.push({...n})}
 return merged;
}
