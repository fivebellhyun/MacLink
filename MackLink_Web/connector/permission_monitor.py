"""Bound native privacy checks independently of media and input packet rates."""
import threading
import time


class PermissionMonitor:
 """Active checks every 50 ms with a strictly 100 ms, fail-closed snapshot.

 Native privacy APIs run on one dedicated worker, not the asyncio media/input
 loop. A slow or failed check never extends the previous successful result.
 Capture and input injection still perform their own live native checks.
 """
 def __init__(self,screen_check,control_check,*,interval=.05,max_age=.1,clock=time.monotonic,active=True):
  if interval<=0 or max_age<interval:raise ValueError('Invalid permission freshness bounds')
  self.screen_check=screen_check;self.control_check=control_check
  self.interval=interval;self.max_age=max_age;self.clock=clock
  self._lock=threading.Lock();self._stopped=threading.Event();self._changed=threading.Event();self._thread=None
  self._active=bool(active);self._generation=0
  self._sample=(None,False,False)

 def refresh(self):
  # Timestamp the start, so slow native calls cannot publish stale grants as new.
  started=self.clock()
  with self._lock:generation=self._generation
  try:screen=bool(self.screen_check());control=bool(self.control_check())
  except Exception:
   with self._lock:
    if generation==self._generation:self._sample=(None,False,False)
   return
  with self._lock:
   if self._stopped.is_set():self._sample=(None,False,False)
   elif generation==self._generation:self._sample=(started,screen,control)

 def read(self):
  with self._lock:
   checked,screen,control=self._sample;max_age=self.max_age if self._active else .6
  if checked is None or not 0<=self.clock()-checked<max_age:return None
  return screen,control

 def snapshot(self):return self.read() or (False,False)

 def decision(self,control=False):
  sample=self.read()
  if sample is None:return None
  screen,accessible=sample
  return screen and (not control or accessible)

 def allows(self,control=False):
  return self.decision(control) is True

 def set_active(self,active):
  active=bool(active)
  with self._lock:
   if active==self._active:return
   self._active=active;self._generation+=1
   # An idle result cannot grant media access until a new active check finishes.
   if active:self._sample=(None,False,False)
  self._changed.set()

 def start(self):
  if self._thread is not None:return
  self._thread=threading.Thread(target=self._run,name='MacLink privacy checks',daemon=True)
  self._thread.start()

 def _run(self):
  while not self._stopped.is_set():
   with self._lock:interval=self.interval if self._active else .5
   self._changed.wait(interval);self._changed.clear()
   if not self._stopped.is_set():self.refresh()

 def stop(self):
  self._stopped.set()
  self._changed.set()
  with self._lock:self._sample=(None,False,False)
  # A stuck native call must not hold shutdown or retain a usable snapshot.
  if self._thread is not None:self._thread.join(timeout=self.max_age)
