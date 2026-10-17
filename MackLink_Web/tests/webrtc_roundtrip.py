"""Real aiortc media and data-channel loopback; synthetic pixels, no Mac access."""
import asyncio, concurrent.futures, json, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
from aiortc import RTCPeerConnection,RTCConfiguration
from PIL import Image
from media import DesktopVideoTrack
from protocol import valid
async def test():
 conf=RTCConfiguration(iceServers=[])
 viewer,host=RTCPeerConnection(conf),RTCPeerConnection(conf)
 pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
 frame_ready=asyncio.Future();input_ready=asyncio.Future()
 viewer.addTransceiver('video',direction='recvonly');channel=viewer.createDataChannel('control',ordered=True)
 @viewer.on('track')
 def track(t):
  async def read():
   try:frame_ready.set_result(await t.recv())
   except Exception as e:frame_ready.set_exception(e)
  asyncio.create_task(read())
 @channel.on('open')
 def opened():channel.send(json.dumps({'type':'key','code':'KeyA','down':True,'seq':1}))
 @host.on('datachannel')
 def arrived(c):
  @c.on('message')
  def message(raw):
   e=json.loads(raw)
   if valid(e) and not input_ready.done():input_ready.set_result(e)
 try:
  await viewer.setLocalDescription(await viewer.createOffer())
  await host.setRemoteDescription(viewer.localDescription)
  host.addTrack(DesktopVideoTrack(lambda:Image.new('RGB',(640,400),(40,110,70)),pool))
  await host.setLocalDescription(await host.createAnswer())
  await viewer.setRemoteDescription(host.localDescription)
  frame,event=await asyncio.wait_for(asyncio.gather(frame_ready,input_ready),15)
  assert (frame.width,frame.height)==(640,400)
  assert event['code']=='KeyA'
  print('PASS: encrypted WebRTC video 640x400 decoded; ordered control data channel delivered a validated key event.')
 finally:
  await viewer.close();await host.close();pool.shutdown(wait=True)
asyncio.run(test())
