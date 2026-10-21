/* PCM playback only. No microphone, compression, gain or voice processing. */
class MacLinkSystemAudio extends AudioWorkletProcessor{
 constructor(){super();this.capacity=12000;this.target=5760;this.left=new Float32Array(this.capacity);this.right=new Float32Array(this.capacity);this.read=0;this.count=0;this.active=false;this.buffered=false;this.playing=false;this.stopped=false;this.port.onmessage=event=>this.message(event.data);}
 reset(){this.read=0;this.count=0;this.active=false;this.buffered=false;this.playing=false;this.left.fill(0);this.right.fill(0);}
 refill(adapt=false){this.active=false;this.buffered=false;this.playing=false;if(adapt)this.target=Math.min(9600,this.target+960);this.port.postMessage({type:'buffering'});}
 message(message){
  if(message?.type==='stop'){this.reset();this.stopped=true;return;}
  if(this.stopped)return;
  if(message?.type==='activate'){if(this.buffered&&this.count>=this.target)this.active=true;return;}
  // A temporary sender pause must not play stale queued audio after recovery.
  if(message?.type==='rebuffer'){this.reset();this.refill();return;}
  if(message?.type!=='samples')return;
  const frames=message.frames,samples=message.samples;
  if(!Number.isInteger(frames)||frames<1||frames>960||!(samples instanceof Float32Array)||samples.length!==frames*2){this.reset();this.port.postMessage({type:'error'});return;}
  for(let i=0;i<samples.length;i++)if(!Number.isFinite(samples[i])){this.reset();this.port.postMessage({type:'error'});return;}
  // Drop old queued frames on overflow so latency never grows beyond 250 ms.
  if(this.count+frames>this.capacity){const drop=this.count+frames-this.target;this.read=(this.read+drop)%this.capacity;this.count-=drop;}
  for(let i=0;i<frames;i++){const index=(this.read+this.count)%this.capacity;this.left[index]=samples[i*2];this.right[index]=samples[i*2+1];this.count++;}
  this.port.postMessage({type:'received',frames});
  if(!this.active&&!this.buffered&&this.count>=this.target){this.buffered=true;this.port.postMessage({type:'buffered'});}
 }
 process(_inputs,outputs){
  const output=outputs[0];if(!output||output.length<2)return !this.stopped;const left=output[0],right=output[1];left.fill(0);right.fill(0);
  if(this.stopped)return false;if(!this.active)return true;
  // Keep the partial quantum untouched. A short gap produces silence while
  // the same output refills, rather than permanently disabling PCM.
  if(this.count<left.length){this.refill(true);return true;}
  for(let i=0;i<left.length;i++){left[i]=this.left[this.read];right[i]=this.right[this.read];this.read=(this.read+1)%this.capacity;this.count--;}
  if(!this.playing){this.playing=true;this.port.postMessage({type:'playing'});}return true;
 }
}
registerProcessor('maclink-system-audio',MacLinkSystemAudio);
