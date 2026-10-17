"""Permission polls remain bounded after removing the media relay."""
import asyncio
import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
from maclink import SessionAuthorization, agent_request, poll_delay, remaining_poll_delay

class FakeClient:
 def __init__(self,delays,default_timeout=12):
  self.delays=iter(delays);self.default_timeout=default_timeout;self.requests=[]
 def post(self,url,**kwargs):
  self.requests.append((url,kwargs));delay=next(self.delays)
  timeout=kwargs.get('timeout');limit=timeout.total if timeout is not None else self.default_timeout
  class Response:
   async def __aenter__(self):
    await asyncio.wait_for(asyncio.sleep(delay),limit);return self
   async def __aexit__(self,*_):return False
   async def json(self):return {'session':{'status':'active'}}
  return Response()

class PollRecoveryTests(unittest.IsolatedAsyncioTestCase):
 async def test_timeout_recovers_within_seventeen_second_permission_window(self):
  client=FakeClient([8,0]);last_ok=time.monotonic()
  await asyncio.sleep(poll_delay(0));started=time.monotonic()
  with self.assertRaises(asyncio.TimeoutError):
   async with agent_request(client,'poll','https://example.invalid/poll',json={}):self.fail('Stalled check must time out.')
  await asyncio.sleep(remaining_poll_delay(poll_delay(1),started,time.monotonic()))
  async with agent_request(client,'poll','https://example.invalid/poll',json={}) as response:
   self.assertEqual((await response.json())['session']['status'],'active')
  self.assertLess(time.monotonic()-last_ok,SessionAuthorization.freshness)
  self.assertEqual(len(client.requests),2);self.assertEqual(client.requests[0][1]['timeout'].total,6)
 async def test_usable_slow_response_keeps_its_six_second_budget(self):
  client=FakeClient([1.6])
  async with agent_request(client,'poll','https://example.invalid/poll',json={}) as response:
   self.assertEqual((await response.json())['session']['status'],'active')
  self.assertEqual(client.requests[0][1]['timeout'].total,6)
 async def test_mutations_keep_client_timeout_and_are_not_retried(self):
  class Client:
   def __init__(self):self.requests=[]
   def post(self,url,**kwargs):
    self.requests.append((url,kwargs));raise ConnectionError('Network interruption')
  client=Client()
  for action in ('answer','decision','recover','end'):
   before=len(client.requests)
   with self.assertRaises(ConnectionError):agent_request(client,action,'https://example.invalid/'+action,json={})
   self.assertEqual(len(client.requests),before+1);self.assertNotIn('timeout',client.requests[-1][1])
 async def test_poll_interval_includes_request_duration(self):
  self.assertEqual(poll_delay(0),4)
  for elapsed in (0,1.5,2,3.9,4,6):self.assertAlmostEqual(remaining_poll_delay(4,100,100+elapsed),max(0,4-elapsed))
  self.assertEqual(remaining_poll_delay(10,100,101.5),8.5)
 async def test_outages_use_bounded_backoff(self):
  delays=[poll_delay(failures) for failures in range(1,100)]
  self.assertEqual(delays,sorted(delays));self.assertEqual(delays[:6],[4,4,4,4,5,10]);self.assertEqual(max(delays),10)

if __name__=='__main__':unittest.main()
