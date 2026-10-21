"""Privacy checks stay bounded without a cached grant reaching input injection."""
import asyncio
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
from maclink import MacInput
from permission_monitor import PermissionMonitor


class PermissionSnapshotTests(unittest.TestCase):
 def setUp(self):
  self.now=10.;self.screen=True;self.control=True;self.calls=[]
  self.monitor=PermissionMonitor(self.check_screen,self.check_control,clock=lambda:self.now)
 def tearDown(self):self.monitor.stop()
 def check_screen(self):self.calls.append('screen');return self.screen
 def check_control(self):self.calls.append('control');return self.control

 def test_unknown_and_exact_expiration_fail_closed(self):
  self.assertEqual(self.monitor.snapshot(),(False,False))
  self.now=0.
  self.monitor.refresh();self.assertTrue(self.monitor.allows(True))
  self.now=.099;self.assertTrue(self.monitor.allows(True))
  self.now=.1;self.assertEqual(self.monitor.snapshot(),(False,False))
  self.now=-.01;self.assertEqual(self.monitor.snapshot(),(False,False))

 def test_audio_rate_snapshot_reads_do_not_call_native_apis(self):
  self.monitor.refresh()
  for _ in range(10000):self.assertTrue(self.monitor.allows(True))
  self.assertEqual(self.calls,['screen','control'])

 def test_revocation_replaces_grant_and_view_mode_does_not_require_control(self):
  self.monitor.refresh();self.control=False;self.monitor.refresh()
  self.assertTrue(self.monitor.allows(False));self.assertFalse(self.monitor.allows(True))
  self.screen=False;self.monitor.refresh();self.assertFalse(self.monitor.allows(False))
  self.screen=self.control=True;self.monitor.refresh();self.assertTrue(self.monitor.allows(True))

 def test_failed_or_slow_native_check_cannot_publish_fresh_grants(self):
  self.monitor.refresh()
  def fail():raise RuntimeError('native check failed')
  self.monitor.screen_check=fail;self.monitor.refresh()
  self.assertEqual(self.monitor.snapshot(),(False,False))
  self.assertIsNone(self.monitor.decision(True))
  def slow():self.now+=.11;return True
  self.monitor.screen_check=slow;self.monitor.refresh()
  self.assertEqual(self.monitor.snapshot(),(False,False))
  self.assertIsNone(self.monitor.decision(True))

 def test_unknown_blocks_media_without_becoming_a_confirmed_revocation(self):
  self.monitor.refresh();self.assertIs(self.monitor.decision(True),True)
  self.now+=.11
  self.assertIsNone(self.monitor.decision(True));self.assertFalse(self.monitor.allows(True))
  # A recovered check can resume the same peer; only an actual false is denial.
  self.monitor.refresh();self.assertIs(self.monitor.decision(True),True)
  self.screen=False;self.monitor.refresh();self.assertIs(self.monitor.decision(True),False)

 def test_idle_snapshot_cannot_authorize_an_activated_session(self):
  self.monitor.set_active(False);self.monitor.refresh();self.now+=.5
  self.assertEqual(self.monitor.snapshot(),(True,True))
  self.monitor.set_active(True)
  self.assertIsNone(self.monitor.decision(True));self.assertFalse(self.monitor.allows(True))
  self.monitor.refresh();self.assertTrue(self.monitor.allows(True))
  self.now+=.11;self.assertIsNone(self.monitor.decision(True))

 def test_old_idle_check_finishing_after_activation_cannot_restore_idle_grant(self):
  entered=threading.Event();finish=threading.Event()
  self.monitor.set_active(False)
  def blocked():entered.set();finish.wait(1);return True
  self.monitor.screen_check=blocked
  worker=threading.Thread(target=self.monitor.refresh);worker.start()
  self.assertTrue(entered.wait(.5));self.monitor.set_active(True)
  finish.set();worker.join(.5)
  self.assertIsNone(self.monitor.decision(True))
  self.monitor.refresh();self.assertTrue(self.monitor.allows(True))

 def test_stop_invalidates_grant_even_if_old_refresh_finishes(self):
  entered=threading.Event();finish=threading.Event()
  def blocked():entered.set();finish.wait(1);return True
  self.monitor.screen_check=blocked
  worker=threading.Thread(target=self.monitor.refresh);worker.start()
  self.assertTrue(entered.wait(.5));self.monitor.stop();finish.set();worker.join(.5)
  self.assertEqual(self.monitor.snapshot(),(False,False))

 def test_each_control_event_rechecks_live_accessibility_after_snapshot_grant(self):
  self.monitor.refresh();trusted=[True];checks=[];sent=[]
  def live_check():checks.append(1);return trusted[0]
  controller=MacInput(SimpleNamespace(),SimpleNamespace(AXIsProcessTrusted=live_check))
  controller.key=lambda code,down:sent.append((code,down))
  event={'type':'key','code':'KeyA','down':True,'seq':1}
  controller.accept(event,self.monitor.allows(True))
  # Snapshot is still granted, but an actual injection must observe revocation.
  trusted[0]=False;controller.accept({**event,'seq':2},self.monitor.allows(True))
  self.assertEqual(checks,[1,1]);self.assertEqual(sent,[('KeyA',True)])


class PermissionWorkerTests(unittest.IsolatedAsyncioTestCase):
 async def test_idle_cadence_is_low_but_session_activation_wakes_the_worker(self):
  calls=[];monitor=PermissionMonitor(lambda:calls.append(time.monotonic()) or True,lambda:True,active=False)
  monitor.refresh();monitor.start()
  try:
   await asyncio.sleep(.12);self.assertEqual(len(calls),1)
   monitor.set_active(True)
   deadline=time.monotonic()+.15
   while monitor.decision(True) is None and time.monotonic()<deadline:await asyncio.sleep(.005)
   self.assertTrue(monitor.allows(True));self.assertGreaterEqual(len(calls),2)
  finally:monitor.stop()

 async def test_slow_native_api_runs_off_event_loop_and_stale_result_denies(self):
  entered=threading.Event();finish=threading.Event();threads=[]
  def check():
   threads.append(threading.get_ident());entered.set();finish.wait(1);return True
  monitor=PermissionMonitor(check,lambda:True)
  monitor.start()
  try:
   deadline=time.monotonic()+.5
   while not entered.is_set() and time.monotonic()<deadline:await asyncio.sleep(.005)
   self.assertTrue(entered.is_set())
   # Event-loop progress/input handling is independent of a stuck privacy API.
   ticks=[]
   for _ in range(5):ticks.append(1);await asyncio.sleep(.005)
   self.assertEqual(len(ticks),5);self.assertNotEqual(threads[0],threading.get_ident())
   self.assertFalse(monitor.allows(True))
  finally:finish.set();monitor.stop()

 async def test_one_worker_limits_checks_despite_frequent_media_reads(self):
  calls=[];monitor=PermissionMonitor(lambda:calls.append(time.monotonic()) or True,lambda:True)
  monitor.refresh();monitor.start()
  try:
   until=time.monotonic()+.22
   while time.monotonic()<until:
    for _ in range(100):monitor.allows(True)
    await asyncio.sleep(.001)
   self.assertGreaterEqual(len(calls),3)
   self.assertLessEqual(len(calls),6)
   self.assertTrue(all(b-a>=.045 for a,b in zip(calls,calls[1:])))
  finally:monitor.stop()


if __name__=='__main__':unittest.main()
