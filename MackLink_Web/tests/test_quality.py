import re, sys, unittest, asyncio, concurrent.futures
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'connector'))
from PIL import Image
from quality import PROFILES, QualitySettings, prepare_capture
from media import DesktopVideoTrack
import media as media_module

class QualityTests(unittest.TestCase):
 def test_profile_contract_and_untrusted_values(self):
  source=(Path(__file__).resolve().parents[1]/'lib/quality.ts').read_text()
  rows=re.findall(r"id:'(\w+)'.*?width:(\d+|null),height:(\d+|null),fps:(\d+),targetMbps:(\d+),maxMbps:(\d+)",source)
  self.assertEqual({name:(None if w=='null' else int(w),h,int(fps),int(target)*1000000,int(maximum)*1000000) for name,w,h,fps,target,maximum in rows},{name:(p.size,'null',p.fps,p.target_bitrate,p.max_bitrate) for name,p in PROFILES.items()})
  q=QualitySettings()
  for bad in (None,{},'__proto__','4k','shell'):
   self.assertFalse(q.select(bad));self.assertEqual(q.name,'balanced')
 def test_capture_is_bounded_without_upscaling(self):
  for profile in PROFILES.values():
   out=prepare_capture(Image.new('RGB',(4000,2500)),profile)
   self.assertEqual(out.size,(profile.size,round(2500*profile.size/4000)) if profile.size else (4000,2500))
   small=prepare_capture(Image.new('RGB',(800,500)),profile)
   self.assertEqual(small.size,(800,500))
  self.assertEqual(prepare_capture(Image.new('RGB',(2560,1664)),PROFILES['balanced']).size,(1600,1040))
  self.assertEqual(prepare_capture(Image.new('RGB',(900,1601)),PROFILES['low']).size,(900,1601))
  self.assertEqual(prepare_capture(Image.new('RGB',(5120,3200)),PROFILES['ultra']).size,(2560,1600))
  self.assertEqual(prepare_capture(Image.new('RGB',(1000,625)),PROFILES['ultra']).size,(1000,625))
 def test_live_track_changes_resolution_fps_and_preserves_timestamps(self):
  async def run():
   q=QualitySettings();pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
   track=DesktopVideoTrack(lambda:prepare_capture(Image.new('RGB',(3840,2400),(40,110,70)),q.profile),pool,q.profile.fps)
   try:
    previous=-1
    for name in ('balanced','low','high','ultra'):
     q.select(name,track);frame=await track.recv()
     width=PROFILES[name].size or 3840
     self.assertEqual((frame.width,frame.height),(width,round(2400*width/3840)));self.assertEqual(track.fps,PROFILES[name].fps);self.assertGreater(frame.pts,previous);previous=frame.pts
   finally:track.stop();pool.shutdown()
  asyncio.run(run())
 def test_track_validates_initial_and_updated_frame_rates(self):
  for fps in (1,30,60):
   track=DesktopVideoTrack(None,None,fps)
   self.assertEqual(track.fps,fps);track.set_fps(60);self.assertEqual(track.fps,60);track.stop()
  for bad in (0,61,True,None,'60',float('nan'),float('inf')):
   with self.assertRaises(ValueError):DesktopVideoTrack(None,None,bad)
   track=DesktopVideoTrack(None,None)
   try:
    with self.assertRaises(ValueError):track.set_fps(bad)
   finally:track.stop()
 def test_capture_start_pacing_includes_work_without_a_catchup_backlog(self):
  async def run():
   now=[0.0];starts=[];delays=[];real_loop=asyncio.get_running_loop()
   async def sleep(delay):delays.append(delay);now[0]+=delay
   def capture():starts.append(now[0]);now[0]+=.006;return Image.new('RGB',(32,20))
   def execute(executor,callback):
    future=real_loop.create_future();future.set_result(callback());return future
   original_frame=media_module.VideoFrame
   def convert(image):
    now[0]+=.002
    return original_frame.from_image(image)
   fake_asyncio=SimpleNamespace(sleep=sleep,get_running_loop=lambda:SimpleNamespace(run_in_executor=execute),CancelledError=asyncio.CancelledError,Event=asyncio.Event)
   with patch.object(media_module,'time',SimpleNamespace(monotonic=lambda:now[0])),patch.object(media_module,'asyncio',fake_asyncio),patch.object(media_module,'VideoFrame',SimpleNamespace(from_image=convert)):
    track=DesktopVideoTrack(capture,None,60)
    try:
     frames=[await track.recv(),await track.recv()]
     now[0]+=.1  # A delayed encoder/consumer must not cause queued catch-up frames.
     frames.extend((await track.recv(),await track.recv()))
     self.assertAlmostEqual(starts[0],0)
     self.assertAlmostEqual(starts[1]-starts[0],1/60)
     self.assertAlmostEqual(starts[2]-starts[1],.108)
     self.assertAlmostEqual(starts[3]-starts[2],1/60)
     self.assertAlmostEqual(delays[1],1/60-.008)
     self.assertEqual(delays[2],0)
     self.assertTrue(all(b.pts>a.pts for a,b in zip(frames,frames[1:])))
    finally:track.stop()
  asyncio.run(run())
 def test_only_current_encoder_receives_quality_changes(self):
  class Encoding:
   def __init__(self):self.names=[]
   def set_profile(self,name,profile):self.names.append(name)
  q=QualitySettings();first=Encoding();second=Encoding()
  q.bind_encoding(first);q.select('ultra');q.bind_encoding(second);q.select('high');q.bind_encoding(None);q.select('low')
  self.assertEqual(first.names,['balanced','ultra']);self.assertEqual(second.names,['ultra','high'])

if __name__=='__main__':unittest.main()
