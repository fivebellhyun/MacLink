"""Screen-to-WebRTC adapter; the screen source is injected for testability."""
import asyncio, time
from fractions import Fraction
from aiortc import VideoStreamTrack
from aiortc.mediastreams import MediaStreamError
from av import VideoFrame
class DesktopVideoTrack(VideoStreamTrack):
 def __init__(self,capture,executor,fps=15,gate=None):
  super().__init__();self.set_fps(fps);self.capture=capture;self.executor=executor;self.origin=time.monotonic();self.last=None;self.gate=gate or (lambda:True);self.paused=False;self.revision=0;self.changed=asyncio.Event();self.inflight=None
 def set_fps(self,fps):
  if isinstance(fps,bool) or not isinstance(fps,(int,float)) or not 1<=fps<=60:raise ValueError('Invalid frame rate')
  self.fps=fps
 def pause(self):
  if not self.paused:self.paused=True;self.revision+=1
  self.changed.set()
 def resume(self):
  if self.readyState=='live':self.paused=False;self.changed.set()
 def stop(self):
  self.revision+=1;super().stop();self.changed.set()
  if self.inflight:self.inflight.cancel()
 def permitted(self):
  return self.readyState=='live' and not self.paused and self.gate()
 async def recv(self):
  while self.readyState=='live':
   if not self.permitted():
    self.changed.clear()
    try:await asyncio.wait_for(self.changed.wait(),0.1)
    except asyncio.TimeoutError:pass
    continue
   revision=self.revision
   await asyncio.sleep(0 if self.last is None else max(0,self.last+1/self.fps-time.monotonic()))
   if revision!=self.revision or not self.permitted():continue
   def capture_if_permitted():
    if revision!=self.revision or not self.permitted():return None
    started=time.monotonic()
    return self.capture(),started
   pending=asyncio.get_running_loop().run_in_executor(self.executor,capture_if_permitted);self.inflight=pending
   try:result=await pending
   except asyncio.CancelledError:
    if self.readyState!='live':raise MediaStreamError
    raise
   finally:
    if self.inflight is pending:self.inflight=None
   # A capture already running in a worker cannot be cancelled. Discard its
   # result if permission expired or this attachment was paused/replaced.
   if result is None or revision!=self.revision or not self.permitted():continue
   image,started=result
   if image is None:continue
   frame=VideoFrame.from_image(image)
   if revision!=self.revision or not self.permitted():continue
   # Pace from the actual capture start. Slow frames reset this anchor instead
   # of building a backlog, and capture/conversion time consumes the interval.
   self.last=started;frame.pts=int((started-self.origin)*90000);frame.time_base=Fraction(1,90000)
   return frame
  raise MediaStreamError
