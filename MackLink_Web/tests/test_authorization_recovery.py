"""Retain transport, but never extend screen/input authorization through an outage."""
import asyncio
import concurrent.futures
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
from PIL import Image
from aiortc.mediastreams import MediaStreamError
from maclink import SessionAuthorization, close_attachment
from media import DesktopVideoTrack


def active(generation=0):return {'id':'test-session','generation':generation,'status':'active'}


class AuthorizationRecoveryTests(unittest.IsolatedAsyncioTestCase):
 def setUp(self):
  self.now=100.;self.lease=SessionAuthorization(lambda:self.now)
  self.session=active();self.lease.confirm(self.session)

 async def test_repeated_status_timeouts_pause_without_discarding_the_peer(self):
  peer=object()
  # Permission remains valid strictly before the user-selected 17-second
  # boundary. Transport retention continues separately until 30 seconds.
  self.assertEqual(self.lease.freshness,17)
  self.now+=16.999
  self.assertTrue(self.lease.allows(self.session))
  self.now+=.001
  self.assertFalse(self.lease.allows(self.session));self.assertTrue(self.lease.retain(self.session))
  retained_peer=peer if self.lease.retain(self.session) else None
  self.now+=.4;self.lease.confirm(self.session)
  self.assertIs(retained_peer,peer);self.assertTrue(self.lease.allows(self.session))

 async def test_four_second_polls_keep_permission_through_missed_checks_but_stop_at_seventeen(self):
  for elapsed in (4,8,12,16):
   self.now=100+elapsed
   self.assertTrue(self.lease.allows(self.session),elapsed)
  self.now=117
  self.assertFalse(self.lease.allows(self.session));self.assertTrue(self.lease.retain(self.session))
  self.lease.revoke()
  self.assertFalse(self.lease.allows(self.session));self.assertFalse(self.lease.retain(self.session))

 async def test_retained_transport_expires_and_only_active_same_generation_restores_permission(self):
  self.now+=30
  self.assertFalse(self.lease.allows(self.session));self.assertFalse(self.lease.retain(self.session))
  self.lease.confirm({**self.session,'status':'approved'})
  self.assertFalse(self.lease.allows(self.session))
  self.lease.confirm(active(1))
  self.assertFalse(self.lease.allows(self.session));self.assertTrue(self.lease.allows(active(1)))
  self.lease.confirm(None)
  self.assertFalse(self.lease.allows(active(1)));self.assertFalse(self.lease.retain(active(1)))
  self.lease.confirm(self.session);self.lease.revoke()
  self.assertFalse(self.lease.allows(self.session))

 async def test_slow_old_peer_close_cannot_clear_replacement_attachment(self):
  closing=asyncio.Event();finish=asyncio.Event();old_owner=object();new_owner=object()
  class Peer:
   async def close(self):closing.set();await finish.wait()
  track=SimpleNamespace(stop=lambda:None)
  controller=SimpleNamespace(seq=8,release=lambda:None)
  quality=SimpleNamespace(select=lambda _:None)
  state={'owner':old_owner,'pc':Peer(),'track':track,'setting':None,'session':self.session,'ready':True,'channel':None}
  task=asyncio.create_task(close_attachment(state,self.lease,controller,quality,old_owner))
  await asyncio.wait_for(closing.wait(),.5)
  self.assertIsNone(state['pc']);self.assertIsNone(state['session']);self.assertFalse(self.lease.allows(self.session))
  replacement=object();new_session=active(1)
  state.update(owner=new_owner,pc=replacement,session=new_session,track=track,ready=True)
  self.lease.confirm(new_session);finish.set();await task
  self.assertIs(state['pc'],replacement);self.assertIs(state['owner'],new_owner);self.assertTrue(self.lease.allows(new_session))
  await close_attachment(state,self.lease,controller,quality,old_owner)
  self.assertIs(state['pc'],replacement);self.assertTrue(self.lease.allows(new_session))

 async def test_peer_cleanup_can_be_scheduled_without_delaying_authorization_polling(self):
  closing=asyncio.Event();finish=asyncio.Event();owner=object();scheduled=[]
  class Peer:
   async def close(self):closing.set();await finish.wait()
  controller=SimpleNamespace(seq=0,release=lambda:None);quality=SimpleNamespace(select=lambda _:None)
  state={'owner':owner,'pc':Peer(),'track':None,'setting':None,'session':self.session,'ready':True}
  def retire(peer):scheduled.append(asyncio.create_task(peer.close()))
  await asyncio.wait_for(close_attachment(state,self.lease,controller,quality,owner,retire),.2)
  await asyncio.wait_for(closing.wait(),.2)
  self.assertIsNone(state['pc']);self.assertFalse(scheduled[0].done())
  # A new successful heartbeat is independent of the old peer's slow close.
  self.lease.confirm(active(1));self.assertTrue(self.lease.allows(active(1)))
  finish.set();await scheduled[0]

 async def test_expired_lease_prevents_capture_and_same_peer_track_resumes(self):
  calls=[];pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
  track=DesktopVideoTrack(lambda:(calls.append(1) or Image.new('RGB',(8,8),'green')),pool,fps=30,gate=lambda:self.lease.allows(self.session))
  self.now+=17
  pending=asyncio.create_task(track.recv())
  try:
   await asyncio.sleep(.13)
   self.assertFalse(pending.done());self.assertEqual(calls,[])
   self.lease.confirm(self.session);track.resume()
   frame=await asyncio.wait_for(pending,.5)
   self.assertEqual((frame.width,frame.height),(8,8));self.assertEqual(len(calls),1)
  finally:track.stop();pool.shutdown()

 async def test_capture_crossing_expiry_is_discarded_even_if_permission_restores_before_it_finishes(self):
  entered=threading.Event();release=threading.Event();calls=[]
  def capture():
   calls.append(1)
   if len(calls)==1:entered.set();release.wait(2);return Image.new('RGB',(8,8),'red')
   return Image.new('RGB',(8,8),'blue')
  pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
  track=DesktopVideoTrack(capture,pool,fps=30,gate=lambda:self.lease.allows(self.session))
  pending=asyncio.create_task(track.recv())
  try:
   self.assertTrue(await asyncio.to_thread(entered.wait,.5))
   self.now+=17.1;track.pause();self.lease.confirm(self.session);track.resume();release.set()
   frame=await asyncio.wait_for(pending,.5)
   self.assertEqual(frame.to_image().getpixel((0,0)),(0,0,255));self.assertEqual(len(calls),2)
  finally:release.set();track.stop();pool.shutdown()

 async def test_inflight_capture_is_never_delivered_during_expiry(self):
  entered=threading.Event();release=threading.Event()
  def capture():entered.set();release.wait(2);return Image.new('RGB',(8,8),'red')
  pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
  track=DesktopVideoTrack(capture,pool,fps=30,gate=lambda:self.lease.allows(self.session))
  pending=asyncio.create_task(track.recv())
  try:
   self.assertTrue(await asyncio.to_thread(entered.wait,.5));self.now+=17.1;release.set()
   await asyncio.sleep(.13);self.assertFalse(pending.done())
   track.stop()
   with self.assertRaises(MediaStreamError):await asyncio.wait_for(pending,.3)
  finally:release.set();track.stop();pool.shutdown()

 async def test_stopping_a_blocked_capture_wakes_recv_without_waiting_for_worker(self):
  entered=threading.Event();release=threading.Event()
  def capture():entered.set();release.wait(2);return Image.new('RGB',(8,8),'red')
  pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
  track=DesktopVideoTrack(capture,pool,fps=30,gate=lambda:self.lease.allows(self.session))
  pending=asyncio.create_task(track.recv())
  try:
   self.assertTrue(await asyncio.to_thread(entered.wait,.5));self.lease.revoke();track.stop()
   with self.assertRaises(MediaStreamError):await asyncio.wait_for(pending,.3)
  finally:release.set();track.stop();pool.shutdown()

 async def test_replacement_generation_or_revocation_cannot_resume_stale_track(self):
  pool=concurrent.futures.ThreadPoolExecutor(max_workers=1);calls=[]
  track=DesktopVideoTrack(lambda:(calls.append(1) or Image.new('RGB',(8,8))),pool,fps=30,gate=lambda:self.lease.allows(self.session))
  pending=None
  try:
   self.lease.confirm(active(1));track.resume();pending=asyncio.create_task(track.recv())
   await asyncio.sleep(.13);self.assertFalse(pending.done());self.assertEqual(calls,[])
   self.lease.revoke();track.resume();await asyncio.sleep(.13)
   self.assertFalse(pending.done());self.assertEqual(calls,[])
   track.stop();track.resume()
   with self.assertRaises(MediaStreamError):await asyncio.wait_for(pending,.3)
  finally:track.stop();pool.shutdown()


if __name__=='__main__':unittest.main()
