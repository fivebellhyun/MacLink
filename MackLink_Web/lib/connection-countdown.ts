/** An estimate for initial ICE preparation, never a connection timeout. */
export type ConnectionProgress={deviceId:string;remaining:number};
type CountdownClock={now:()=>number;setInterval:(callback:()=>void,ms:number)=>unknown;clearInterval:(timer:unknown)=>void};
const clock:CountdownClock={now:()=>performance.now(),setInterval:(callback,ms)=>setInterval(callback,ms),clearInterval:timer=>clearInterval(timer as ReturnType<typeof setInterval>)};
export class ConnectionCountdown {
 private active:{deviceId:string;deadline:number;timer:unknown}|null=null;
 private changed:(progress:ConnectionProgress|null)=>void;
 private clock:CountdownClock;
 constructor(changed:(progress:ConnectionProgress|null)=>void,environment:CountdownClock=clock){this.changed=changed;this.clock=environment;}
 start(deviceId:string){
  if(this.active)return null;
  const attempt={deviceId,deadline:this.clock.now()+20000,timer:null as unknown};this.active=attempt;
  this.changed({deviceId,remaining:20});
  const tick=()=>{
   if(this.active!==attempt)return;
   const remaining=Math.max(0,Math.ceil((attempt.deadline-this.clock.now())/1000));
   this.changed({deviceId,remaining});
   if(!remaining){this.clock.clearInterval(attempt.timer);attempt.timer=null;}
  };
  attempt.timer=this.clock.setInterval(tick,1000);
  return()=>{if(this.active===attempt)this.cancel();};
 }
 cancel(notify=true){
  const attempt=this.active;this.active=null;
  if(attempt?.timer!==null&&attempt?.timer!==undefined)this.clock.clearInterval(attempt.timer);
  if(attempt&&notify)this.changed(null);
 }
}
