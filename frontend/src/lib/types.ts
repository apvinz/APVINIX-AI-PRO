export type RawNote = {startTimeSeconds:number;durationSeconds:number;pitchMidi:number;amplitude:number};
export type QNote = {start:number;end:number;pitch:number;velocity:number};
export type AnalysisResult = {notes:QNote[];bpm:number;title:string;meter:string;source:'local'|'studio';duration?:number;tracks?:{name:string;count:number}[]};
export type BackendJob = {id:string;state:'queued'|'working'|'done'|'error';stage:string;progress:number;info?:{bpm:number;duration:number;track_names:string[];quality?:{status:string;notice:string;warnings:string[]};note_count?:number;notes?:number;measures?:number}};
