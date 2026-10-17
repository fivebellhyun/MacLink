/** A single bounded, memory-only picture. It is never encoded or persisted. */
export class ScreenFrameBuffer {
 private target:HTMLCanvasElement;
 private scratch:HTMLCanvasElement;
 private valid=false;
 constructor(target:HTMLCanvasElement,makeCanvas:()=>HTMLCanvasElement=()=>document.createElement('canvas')){this.target=target;this.scratch=makeCanvas();}
 get hasFrame(){return this.valid;}
 capture(source:CanvasImageSource,width:number,height:number):boolean {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return false;
  const scale=Math.min(1,2560/Math.max(width,height));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  try{
   // Draw to scratch first: a failed/empty decoder must not erase the last good picture.
   const draft=this.scratch.getContext('2d'),output=this.target.getContext('2d');if(!draft||!output)return false;
   if(this.scratch.width!==w)this.scratch.width=w;if(this.scratch.height!==h)this.scratch.height=h;
   draft.drawImage(source,0,0,w,h);
   if(this.target.width!==w)this.target.width=w;if(this.target.height!==h)this.target.height=h;
   output.drawImage(this.scratch,0,0);this.valid=true;return true;
  }catch{return false;}
 }
 show(){this.target.style.visibility=this.valid?'visible':'hidden';}
 hide(){this.target.style.visibility='hidden';}
 clear(){this.valid=false;this.hide();this.target.width=0;this.target.height=0;this.scratch.width=0;this.scratch.height=0;}
}

/** Observe decoded frames, not loadedmetadata/ICE events, before revealing a stream. */
export function watchVideoFrames(video:HTMLVideoElement,options:{isCurrent:()=>boolean;onFrame:(time:number)=>void;now?:()=>number}):()=>void {
 let stopped=false,callback:number|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let previousTime=video.currentTime,previousFrames=video.getVideoPlaybackQuality?.().totalVideoFrames??0;
 const now=options.now||(()=>performance.now());
 const current=()=>!stopped&&!video.ended&&options.isCurrent();
 if(typeof video.requestVideoFrameCallback==='function'){
  const frame=(time:number)=>{if(!current())return;if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0)options.onFrame(time);if(current())callback=video.requestVideoFrameCallback(frame);};
  callback=video.requestVideoFrameCallback(frame);
 }else{
  const tick=()=>{
   if(!current())return;
   const frames=video.getVideoPlaybackQuality?.().totalVideoFrames;
   const progressed=frames===undefined?video.currentTime!==previousTime:frames!==previousFrames;
   if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0&&progressed){previousTime=video.currentTime;previousFrames=frames??-1;options.onFrame(now());}
   if(current())timer=setTimeout(tick,80);
  };
  timer=setTimeout(tick,0);
 }
 return()=>{stopped=true;if(callback!==undefined)video.cancelVideoFrameCallback?.(callback);if(timer!==undefined)clearTimeout(timer);};
}

/** Keep a healthy transport through a short signaling outage, within the server lease. */
export function canRetryLivePoll(status:number|undefined,lastConfirmed:number,now:number,healthy:boolean):boolean {
 const transient=status===undefined||status===429||(status>=500&&status<=599);
 return transient&&healthy&&lastConfirmed>0&&now>=lastConfirmed&&now-lastConfirmed<10000;
}
