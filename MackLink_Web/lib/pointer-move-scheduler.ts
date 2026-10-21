/** Keep at most one unsent move; buttons, keys and release remain ordered barriers. */
export type MoveClock = {setTimeout:(callback:()=>void,delay:number)=>unknown;clearTimeout:(timer:unknown)=>void};
const clock:MoveClock={setTimeout:(callback,delay)=>setTimeout(callback,delay),clearTimeout:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
export class PointerMoveScheduler<T> {
 private pending:T|null=null;
 private timer:unknown=null;
 private deliver:(move:T)=>boolean;
 private timers:MoveClock;
 constructor(deliver:(move:T)=>boolean,timers:MoveClock=clock){this.deliver=deliver;this.timers=timers;}
 enqueue(move:T){this.pending=move;this.schedule();}
 private schedule(){if(this.timer!==null)return;this.timer=this.timers.setTimeout(()=>{this.timer=null;const move=this.pending;if(move===null)return;if(this.deliver(move))this.pending=null;if(this.pending!==null)this.schedule();},16);}
 /** A critical event supersedes a congested move instead of queuing behind it. */
 flush(){this.clearTimer();const move=this.pending;this.pending=null;if(move!==null)this.deliver(move);}
 cancel(){this.clearTimer();this.pending=null;}
 private clearTimer(){if(this.timer!==null){this.timers.clearTimeout(this.timer);this.timer=null;}}
}
