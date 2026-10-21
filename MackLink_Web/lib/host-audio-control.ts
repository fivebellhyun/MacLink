/** Audio intent uses the authenticated audio channel; it never grants session access. */
type AudioControlChannel = {readyState:string; bufferedAmount:number; send:(message:string)=>void};
export class HostAudioControl {
 private channel:AudioControlChannel|null=null;
 private revision=0;
 private desired=true;
 private initialized=false;
 private lastSent=-Infinity;
 acknowledged:boolean|null=null;
 bind(channel:AudioControlChannel|null){this.channel=channel;this.revision=0;this.initialized=false;this.lastSent=-Infinity;this.acknowledged=null;}
 sync(enabled:boolean,now=Date.now()){
  if(!this.initialized||this.desired!==enabled){this.initialized=true;this.desired=enabled;this.revision=(this.revision+1)>>>0;this.lastSent=-Infinity;this.acknowledged=null;}
  const channel=this.channel;
  if(!channel||channel.readyState!=='open'||channel.bufferedAmount>1024||this.acknowledged===enabled||now-this.lastSent<1000)return;
  try{channel.send(JSON.stringify({type:'audio-state',enabled,revision:this.revision}));this.lastSent=now;}catch{}
 }
 receive(value:unknown){
  if(typeof value!=='string'||value.length>256)return false;
  let message:unknown;try{message=JSON.parse(value);}catch{return false;}
  if(!message||typeof message!=='object'||Array.isArray(message))return false;
  const ack=message as Record<string,unknown>;
  if(ack.type!=='audio-state'||ack.supported!==true||typeof ack.enabled!=='boolean'||!Number.isSafeInteger(ack.revision)||Number(ack.revision)<0||Number(ack.revision)>0xffffffff||Object.keys(ack).length!==4)return false;
  if(ack.revision===this.revision&&ack.enabled===this.desired)this.acknowledged=ack.enabled;
  return true;
 }
}
