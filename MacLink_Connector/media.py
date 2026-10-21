"""Screen-to-WebRTC adapter; the screen source is injected for testability."""
import asyncio, time, threading
from collections import deque
from fractions import Fraction
from aiortc import AudioStreamTrack, VideoStreamTrack
from aiortc.mediastreams import MediaStreamError
from av import AudioFifo, AudioFrame, AudioResampler, VideoFrame
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


class SystemAudioTrack(AudioStreamTrack):
 """20 ms stereo audio with a bounded queue and the screen's permission lease."""
 rate=48000
 samples=960
 def __init__(self,gate=None,capture_factory=None,status=None,pcm=None):
  super().__init__()
  if capture_factory is None:
   from system_audio import ScreenAudioCapture
   capture_factory=ScreenAudioCapture
  self.gate=gate or (lambda:True);self.factory=capture_factory;self.status=status or (lambda available,error:None)
  self.pcm=pcm
  self.loop=asyncio.get_running_loop();self.changed=asyncio.Event();self.lock=threading.Lock();self.queue=deque(maxlen=5)
  self.capture=None;self.starting=None;self.started=False;self.failed=False;self.paused=False;self.revision=0;self.notified=False
  self.resampler=AudioResampler(format='s16',layout='stereo',rate=self.rate);self.fifo=AudioFifo();self.pcm_fifo=AudioFifo();self.fifo_at=0;self.pts=0;self.origin=time.monotonic();self.last=None
 def permitted(self):return self.readyState=='live' and not self.paused and self.gate()
 def _wake(self):
  self.notified=False;self.changed.set()
 def push(self,frame,revision=None):
  if not self.permitted() or frame.samples>4800 or (revision is not None and revision!=self.revision):return
  with self.lock:
   if not self.permitted() or (revision is not None and revision!=self.revision):return
   self.queue.append((self.revision,time.monotonic(),frame))
   while sum(item[2].samples for item in self.queue)>4800:self.queue.popleft()
   if not self.notified:
    self.notified=True
    if not self.loop.is_closed():self.loop.call_soon_threadsafe(self._wake)
 def _flush(self):
  with self.lock:self.queue.clear()
  self.fifo=AudioFifo();self.pcm_fifo=AudioFifo();self.resampler=AudioResampler(format='s16',layout='stereo',rate=self.rate)
 def _twenty_ms(self,fifo,format):
  partial=fifo.read(self.samples,partial=True) if fifo.samples else None
  if partial is not None and partial.samples==self.samples:return partial
  frame=AudioFrame(format=partial.format.name if partial is not None else format,layout=partial.layout.name if partial is not None else 'stereo',samples=self.samples)
  frame.sample_rate=self.rate
  for index,plane in enumerate(frame.planes):
   if partial is None:data=b''
   else:
    sample_bytes=partial.format.bytes*(1 if partial.format.is_planar else len(partial.layout.channels))
    data=bytes(partial.planes[index])[:partial.samples*sample_bytes]
   plane.update(data+bytes(plane.buffer_size-len(data)))
  return frame
 def pause(self):
  if not self.paused:self.paused=True;self.revision+=1
  self._flush();self.changed.set()
 def resume(self):
  if self.readyState=='live':self.paused=False;self.changed.set()
 def stop(self):
  self.revision+=1;super().stop();self._flush();self.changed.set()
  if self.starting:self.starting.cancel()
  if self.capture:self.capture.close()
 def capture_failed(self,reason):
  def failed():
   if self.readyState!='live':return
   self.failed=True;self._flush();self.status(False,reason)
   if self.capture:self.capture.close()
   self.changed.set()
  if not self.loop.is_closed():self.loop.call_soon_threadsafe(failed)
 async def _wait(self,timeout=.05):
  self.changed.clear()
  try:await asyncio.wait_for(self.changed.wait(),timeout)
  except asyncio.TimeoutError:pass
 async def recv(self):
  while self.readyState=='live':
   if not self.permitted():
    self._flush();await self._wait();continue
   if not self.started:
    self.started=True;self.capture=self.factory(self.push,self.permitted,self.capture_failed,lambda:self.revision)
    try:
     self.starting=asyncio.create_task(self.capture.start());await self.starting
     if self.readyState!='live':raise MediaStreamError
     if not self.failed:self.status(True,None)
    except asyncio.CancelledError:
     self.capture.close()
     if self.readyState!='live':raise MediaStreamError
     raise
    except MediaStreamError:raise
    except Exception as error:
     reason=getattr(error,'reason','capture-failed')
     self.failed=True;self.capture.close();self.status(False,reason if reason in ('permission','unavailable','capture-failed') else 'capture-failed')
    finally:self.starting=None
   if self.failed:await self._wait();continue
   revision=self.revision
   await asyncio.sleep(0 if self.last is None else max(0,self.last+.02-time.monotonic()))
   if revision!=self.revision or not self.permitted():continue
   if time.monotonic()-self.fifo_at>.15:self.fifo=AudioFifo();self.pcm_fifo=AudioFifo()
   while self.fifo.samples<self.samples:
    with self.lock:item=self.queue.popleft() if self.queue else None
    if item is None:break
    captured_revision,captured_at,frame=item
    if captured_revision!=revision or time.monotonic()-captured_at>.15:continue
    frame.pts=None
    if self.pcm:self.pcm_fifo.write(frame)
    for converted in self.resampler.resample(frame):
     converted.pts=None;self.fifo.write(converted)
    self.fifo_at=captured_at
   if revision!=self.revision or not self.permitted():self._flush();continue
   if self.pcm:
    # Raw float FIFO reads preserve source bits and share the RTP clock. When
    # ScreenCaptureKit omits silent buffers, supply only the missing zeros.
    try:self.pcm(self._twenty_ms(self.pcm_fifo,'fltp'))
    except Exception:pass
   frame=self._twenty_ms(self.fifo,'s16')
   now=time.monotonic();self.last=now
   self.pts=max(self.pts,int((now-self.origin)*self.rate))
   frame.pts=self.pts;frame.time_base=Fraction(1,self.rate);self.pts+=self.samples
   return frame
  raise MediaStreamError
