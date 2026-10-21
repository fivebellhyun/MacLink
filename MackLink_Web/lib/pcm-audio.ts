export const PCM_CHANNEL_LABEL='maclink-system-audio';
export const PCM_SAMPLE_RATE=48000,PCM_CHANNELS=2,PCM_MAX_FRAMES=960,PCM_MAX_PACKET_BYTES=16+PCM_MAX_FRAMES*8;
export const PCM_READY=JSON.stringify({type:'ready',format:'pcm-f32le',sampleRate:PCM_SAMPLE_RATE,channels:PCM_CHANNELS});
export const PCM_DISABLED=JSON.stringify({type:'disabled'});
export type PcmPacket={sequence:number;frames:number;samples:Float32Array;gap:boolean};
export function decodePcmPacket(value:unknown,previous:number|null=null):PcmPacket|null{
 if(!(value instanceof ArrayBuffer)||value.byteLength<24||value.byteLength>PCM_MAX_PACKET_BYTES)throw new Error('pcm-packet');
 const view=new DataView(value);if(view.getUint32(0,false)!==0x4d4c5031)throw new Error('pcm-header');
 const sequence=view.getUint32(4,true),frames=view.getUint16(8,true);
 if(!frames||frames>PCM_MAX_FRAMES||view.getUint8(10)!==PCM_CHANNELS||view.getUint8(11)!==1||view.getUint32(12,true)!==PCM_SAMPLE_RATE||value.byteLength!==16+frames*8)throw new Error('pcm-format');
 const delta=previous===null?1:(sequence-previous)>>>0;if(!delta||delta>=0x80000000)return null;
 const samples=new Float32Array(frames*2);for(let i=0;i<samples.length;i++){const sample=view.getFloat32(16+i*4,true);if(!Number.isFinite(sample))throw new Error('pcm-sample');samples[i]=sample;}
 return{sequence,frames,samples,gap:previous!==null&&delta!==1};
}
export function pcmSignal(value:unknown):'pcm-f32le'|'opus'{
 if(typeof value!=='string'||value.length>256||new TextEncoder().encode(value).length>256)throw new Error('pcm-control');
 const signal=JSON.parse(value);if(signal?.type!=='format'||!['pcm-f32le','opus'].includes(signal.format))throw new Error('pcm-control');return signal.format;
}
type AudioEnvironment={AudioContext?:typeof AudioContext;webkitAudioContext?:typeof AudioContext;AudioWorkletNode?:typeof AudioWorkletNode;isSecureContext?:boolean};
export function supportsPcmAudio(environment:AudioEnvironment=globalThis):boolean{const Context=environment.AudioContext||environment.webkitAudioContext;return environment.isSecureContext!==false&&!!Context&&'audioWorklet' in Context.prototype&&typeof environment.AudioWorkletNode==='function';}
type PcmCallbacks={beforePlay:()=>boolean;onPlaying:()=>void;onFailure:(reason:'blocked'|'unavailable'|'invalid'|'timeout'|'underrun')=>void};
/** One peer's PCM output. Create/resume it only from the sound button gesture. */
export class PcmAudioPlayer{
 private context:AudioContext|null=null;private node:AudioWorkletNode|null=null;private revision=0;private sequence:number|null=null;private inTransit=0;private deadline=0;
 prepared=false;ownsOutput=false;
 private readonly callbacks:PcmCallbacks;private readonly environment:AudioEnvironment;
 constructor(callbacks:PcmCallbacks,environment:AudioEnvironment=globalThis){this.callbacks=callbacks;this.environment=environment;}
 async startFromGesture():Promise<void>{
  if(this.context)this.close();const revision=++this.revision;const Context=this.environment.AudioContext||this.environment.webkitAudioContext;
  if(!supportsPcmAudio(this.environment)||!Context){this.fail('unavailable');return;}
  try{
   const context=new Context({sampleRate:PCM_SAMPLE_RATE,latencyHint:'interactive'});this.context=context;
   if(context.sampleRate!==PCM_SAMPLE_RATE)throw new Error('sample-rate');
   // resume() is invoked before awaiting module loading to retain the gesture.
   const resumed=context.resume();let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([resumed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('blocked')),2000);})]);}finally{if(timer)clearTimeout(timer);}
   if(revision!==this.revision)return;if(context.state!=='running')throw new Error('blocked');
   let moduleTimer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([context.audioWorklet.addModule('/system-audio-worklet.js'),new Promise<never>((_,reject)=>{moduleTimer=setTimeout(()=>reject(new Error('module-timeout')),4000);})]);}finally{if(moduleTimer)clearTimeout(moduleTimer);}if(revision!==this.revision)return;
   const Node=this.environment.AudioWorkletNode!;const node=new Node(context,'maclink-system-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});this.node=node;
   node.port.onmessage=event=>{
    if(revision!==this.revision||this.node!==node)return;const message=event.data;
    if(message?.type==='received'&&Number.isInteger(message.frames)&&message.frames>0&&message.frames<=PCM_MAX_FRAMES){this.inTransit=Math.max(0,this.inTransit-message.frames);return;}
    if(message?.type==='buffered'){if(!this.callbacks.beforePlay()){this.fail('unavailable');return;}this.ownsOutput=true;node.port.postMessage({type:'activate'});}
    else if(message?.type==='playing')this.callbacks.onPlaying();
    else if(message?.type==='underrun')this.fail('underrun');
    else if(message?.type==='error')this.fail('invalid');
   };
   context.onstatechange=()=>{if(revision===this.revision&&this.prepared&&context.state!=='running')this.fail('blocked');};
   node.onprocessorerror=()=>{if(revision===this.revision)this.fail('unavailable');};node.connect(context.destination);this.prepared=true;
  }catch(error){if(revision===this.revision)this.fail((error as Error).message==='blocked'||(error as Error).name==='NotAllowedError'?'blocked':'unavailable');}
 }
 expectPackets(now=Date.now()){if(this.prepared&&!this.deadline)this.deadline=now+1500;}
 receive(value:unknown,now=Date.now()){
  if(!this.prepared||!this.node)return;
  try{const packet=decodePcmPacket(value,this.sequence);if(!packet)return;this.sequence=packet.sequence;this.deadline=now+1500;
   if(this.inTransit+packet.frames>12000)throw new Error('pcm-backlog');this.inTransit+=packet.frames;
   this.node.port.postMessage({type:'samples',frames:packet.frames,samples:packet.samples,gap:packet.gap},[packet.samples.buffer]);
  }catch{this.fail('invalid');}
 }
 watchdog(now=Date.now()){if(this.prepared&&this.deadline&&now>this.deadline)this.fail('timeout');}
 private fail(reason:Parameters<PcmCallbacks['onFailure']>[0]){this.close();this.callbacks.onFailure(reason);}
 close(){
  ++this.revision;this.prepared=false;this.ownsOutput=false;this.sequence=null;this.inTransit=0;this.deadline=0;
  const node=this.node;this.node=null;if(node){node.port.onmessage=null;node.onprocessorerror=null;try{node.port.postMessage({type:'stop'});node.disconnect();node.port.close();}catch{}}
  const context=this.context;this.context=null;if(context){context.onstatechange=null;if(context.state!=='closed')try{void context.close().catch(()=>{});}catch{}}
 }
}
