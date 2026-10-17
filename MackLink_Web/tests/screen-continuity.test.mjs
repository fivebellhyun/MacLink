import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ScreenFrameBuffer,watchVideoFrames,canRetryLivePoll} from '../lib/screen-continuity.ts';

// Resizing a real canvas clears its pixels. Preserve that behavior so a failed
// snapshot cannot accidentally pass by leaving an old JavaScript value behind.
class MemoryCanvas {
 constructor(){this._width=300;this._height=150;this.pixel=null;this.style={visibility:'hidden'};this.draws=[];this.context={drawImage:(source,...dimensions)=>{
  if(source.failDraw)throw new Error('Decoder has no drawable image');
  this.pixel=source.pixel;
  this.draws.push({source,dimensions});
 }};}
 get width(){return this._width;}
 set width(value){this._width=value;this.pixel=null;}
 get height(){return this._height;}
 set height(value){this._height=value;this.pixel=null;}
 getContext(){return this.context;}
 toDataURL(){throw new Error('Frames must never be encoded');}
 toBlob(){throw new Error('Frames must never be encoded');}
}

const buffer=()=>{
 const target=new MemoryCanvas(),scratch=new MemoryCanvas();
 return {target,scratch,frames:new ScreenFrameBuffer(target,()=>scratch)};
};

class CallbackVideo extends EventTarget {
 constructor(){super();this.readyState=2;this.videoWidth=1920;this.videoHeight=1080;this.currentTime=0;this.ended=false;this.pending=new Map();this.cancelled=[];this.nextId=1;}
 requestVideoFrameCallback(callback){const id=this.nextId++;this.pending.set(id,callback);return id;}
 cancelVideoFrameCallback(id){this.cancelled.push(id);this.pending.delete(id);}
 takeCallback(){const [id,callback]=this.pending.entries().next().value??[];assert.ok(callback,'A decoded-frame callback should be pending');this.pending.delete(id);return callback;}
 frame(time){this.takeCallback()(time,{presentedFrames:1});}
}

function fakeTimers(t){
 const pending=new Map();let nextId=1;
 t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=nextId++;pending.set(id,{callback,delay});return id;});
 t.mock.method(globalThis,'clearTimeout',id=>pending.delete(id));
 return {
  pending,
  take(){const [id,item]=pending.entries().next().value??[];assert.ok(item,'A playback progress check should be pending');pending.delete(id);return item.callback;},
  tick(){this.take()();},
 };
}

test('frame buffer copies the last picture in memory with a bounded aspect ratio and no upscaling',()=>{
 const {frames,target,scratch}=buffer();
 assert.equal(frames.hasFrame,false);
 for(const [width,height,expected] of [[5120,3200,[2560,1600]],[1600,1000,[1600,1000]],[1440,3840,[960,2560]],[641,479,[641,479]]]){
  const source={pixel:`picture ${width}x${height}`};
  assert.equal(frames.capture(source,width,height),true);
  assert.deepEqual([target.width,target.height],expected);
  assert.deepEqual([scratch.width,scratch.height],expected);
  assert.equal(target.pixel,source.pixel);
  assert.equal(frames.hasFrame,true);
 }
});

test('invalid dimensions, unavailable contexts, and failed decodes retain the last good pixels',()=>{
 const {frames,target,scratch}=buffer();
 frames.capture({pixel:'last good frame'},1280,800);
 frames.show();
 const preserved=()=>{
  assert.equal(frames.hasFrame,true);
  assert.equal(target.pixel,'last good frame');
  assert.deepEqual([target.width,target.height],[1280,800]);
  assert.equal(target.style.visibility,'visible');
 };
 for(const [width,height] of [[0,800],[-1,800],[NaN,800],[Infinity,800],[1280,0],[1280,NaN],[1280,Infinity]]){
  assert.equal(frames.capture({pixel:'invalid'},width,height),false);
  preserved();
 }
 assert.equal(frames.capture({pixel:'empty decoder',failDraw:true},2560,1600),false);
 preserved();
 scratch.context=null;
 assert.equal(frames.capture({pixel:'no context'},1920,1080),false);
 preserved();
});

test('show and hide preserve the picture while clear releases both canvas allocations',()=>{
 const {frames,target,scratch}=buffer();
 frames.show();assert.equal(target.style.visibility,'hidden');
 frames.capture({pixel:'private screen'},1920,1080);
 frames.show();assert.equal(target.style.visibility,'visible');
 frames.hide();assert.equal(target.style.visibility,'hidden');
 assert.equal(frames.hasFrame,true);assert.equal(target.pixel,'private screen');
 frames.show();assert.equal(target.style.visibility,'visible');
 frames.clear();
 assert.equal(frames.hasFrame,false);assert.equal(target.style.visibility,'hidden');
 assert.deepEqual([target.width,target.height,scratch.width,scratch.height],[0,0,0,0]);
 assert.equal(target.pixel,null);assert.equal(scratch.pixel,null);
 frames.show();assert.equal(target.style.visibility,'hidden');
 assert.equal(frames.capture({pixel:'fresh session'},640,400),true);
 assert.equal(target.pixel,'fresh session');
});

test('stream metadata and connection events cannot reveal video before a current decoded frame',()=>{
 const video=new CallbackVideo(),seen=[];let current=true;
 const stop=watchVideoFrames(video,{isCurrent:()=>current,onFrame:time=>seen.push(time)});
 video.dispatchEvent(new Event('loadedmetadata'));
 video.dispatchEvent(new Event('canplay'));
 video.dispatchEvent(new Event('connectionstatechange'));
 assert.deepEqual(seen,[]);
 video.frame(42);
 assert.deepEqual(seen,[42]);
 assert.equal(video.pending.size,1);
 const stale=video.takeCallback();
 current=false;stale(43,{});
 assert.deepEqual(seen,[42]);assert.equal(video.pending.size,0);
 stop();
});

test('callbacks with insufficient decoded data or empty dimensions are ignored',()=>{
 const video=new CallbackVideo(),seen=[];
 const stop=watchVideoFrames(video,{isCurrent:()=>true,onFrame:time=>seen.push(time)});
 video.readyState=1;video.frame(1);
 video.readyState=2;video.videoWidth=0;video.frame(2);
 video.videoWidth=1920;video.videoHeight=0;video.frame(3);
 assert.deepEqual(seen,[]);
 video.videoHeight=1080;video.frame(4);
 assert.deepEqual(seen,[4]);
 stop();assert.equal(video.pending.size,0);
});

test('ending a video stops an already queued callback without revealing or rescheduling it',()=>{
 const video=new CallbackVideo(),seen=[];
 const stop=watchVideoFrames(video,{isCurrent:()=>true,onFrame:time=>seen.push(time)});
 const queued=video.takeCallback();
 video.ended=true;queued(10,{});
 assert.deepEqual(seen,[]);assert.equal(video.pending.size,0);
 stop();
});

test('cleanup cancels callbacks and makes even an escaped callback inert',()=>{
 const video=new CallbackVideo(),seen=[];
 const stop=watchVideoFrames(video,{isCurrent:()=>true,onFrame:time=>seen.push(time)});
 const escaped=video.pending.values().next().value;
 stop();stop();escaped(100,{});
 assert.deepEqual(seen,[]);assert.equal(video.pending.size,0);
 assert.ok(video.cancelled.length>=1);
});

test('a frame that changes the current stream does not schedule another old callback',()=>{
 const video=new CallbackVideo(),seen=[];let current=true;
 const stop=watchVideoFrames(video,{isCurrent:()=>current,onFrame:time=>{seen.push(time);current=false;}});
 video.frame(20);
 assert.deepEqual(seen,[20]);assert.equal(video.pending.size,0);
 stop();
});

test('fallback waits for a decoded-frame count and emits only when that count progresses',t=>{
 const clock=fakeTimers(t),seen=[];
 let count=0,now=100;
 const video={readyState:2,videoWidth:1920,videoHeight:1080,currentTime:0,ended:false,getVideoPlaybackQuality:()=>({totalVideoFrames:count})};
 const stop=watchVideoFrames(video,{isCurrent:()=>true,onFrame:time=>seen.push(time),now:()=>now});
 clock.tick();assert.deepEqual(seen,[]);
 count=1;clock.tick();assert.deepEqual(seen,[100]);
 now=200;video.currentTime=1;clock.tick();assert.deepEqual(seen,[100]);
 count=2;video.readyState=1;clock.tick();assert.deepEqual(seen,[100]);
 video.readyState=2;video.videoWidth=0;clock.tick();assert.deepEqual(seen,[100]);
 video.videoWidth=1920;clock.tick();assert.deepEqual(seen,[100,200]);
 stop();assert.equal(clock.pending.size,0);
});

test('fallback without frame statistics waits for playback time to progress',t=>{
 const clock=fakeTimers(t),seen=[];
 const video={readyState:2,videoWidth:1280,videoHeight:800,currentTime:0,ended:false};
 const stop=watchVideoFrames(video,{isCurrent:()=>true,onFrame:time=>seen.push(time),now:()=>55});
 clock.tick();assert.deepEqual(seen,[]);
 video.currentTime=0.04;clock.tick();assert.deepEqual(seen,[55]);
 clock.tick();assert.deepEqual(seen,[55]);
 video.currentTime=0.08;clock.tick();assert.deepEqual(seen,[55,55]);
 stop();assert.equal(clock.pending.size,0);
});

test('fallback timers from an obsolete or ended stream cannot emit or reschedule',t=>{
 const clock=fakeTimers(t),seen=[];let current=true;
 const video={readyState:2,videoWidth:1280,videoHeight:800,currentTime:1,ended:false};
 const stop=watchVideoFrames(video,{isCurrent:()=>current,onFrame:time=>seen.push(time)});
 const stale=clock.take();current=false;stale();
 assert.deepEqual(seen,[]);assert.equal(clock.pending.size,0);stop();
 current=true;
 const stopEnded=watchVideoFrames(video,{isCurrent:()=>current,onFrame:time=>seen.push(time)});
 const ended=clock.take();video.ended=true;ended();
 assert.deepEqual(seen,[]);assert.equal(clock.pending.size,0);stopEnded();
});

test('fallback cleanup clears the timer and guards a callback already taken by the event loop',t=>{
 const clock=fakeTimers(t),seen=[];
 const video={readyState:2,videoWidth:1280,videoHeight:800,currentTime:1,ended:false};
 const stop=watchVideoFrames(video,{isCurrent:()=>true,onFrame:time=>seen.push(time)});
 const escaped=clock.pending.values().next().value.callback;
 stop();escaped();
 assert.deepEqual(seen,[]);assert.equal(clock.pending.size,0);
});

test('healthy live transports can retry only transient poll failures within the last confirmed lease window',()=>{
 for(const status of [undefined,429,500,502,503,504,599]){
  assert.equal(canRetryLivePoll(status,1000,1000,true),true,`status ${status} at confirmation`);
  assert.equal(canRetryLivePoll(status,1000,10999,true),true,`status ${status} before deadline`);
 }
});

test('hard authorization failures and transports without a confirmed healthy connection never retry live',()=>{
 for(const status of [200,400,401,403,404,408,409,499,600])assert.equal(canRetryLivePoll(status,1000,1500,true),false,`hard status ${status}`);
 for(const status of [undefined,429,503]){
  assert.equal(canRetryLivePoll(status,1000,1500,false),false,'unhealthy or disconnected transport');
  assert.equal(canRetryLivePoll(status,0,1500,true),false,'no successful lease confirmation');
 }
});

test('live poll retry stops exactly at ten seconds and rejects a clock earlier than confirmation',()=>{
 for(const status of [undefined,429,503]){
  assert.equal(canRetryLivePoll(status,1000,11000,true),false,'exact deadline');
  assert.equal(canRetryLivePoll(status,1000,11001,true),false,'expired deadline');
  assert.equal(canRetryLivePoll(status,1000,999,true),false,'clock moved backwards');
 }
});
