import asyncio, concurrent.futures, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
from PIL import Image
from media import DesktopVideoTrack
async def test():
 pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
 track=DesktopVideoTrack(lambda:Image.new('RGB',(640,400),(40,110,70)),pool)
 try:
  a=await track.recv();b=await track.recv()
  assert (a.width,a.height)==(640,400)
  assert b.pts>a.pts and a.time_base.numerator==1 and a.time_base.denominator==90000
  assert a.to_image().getpixel((0,0))==(40,110,70)
  print('PASS: production video adapter preserves pixels, 640x400 dimensions and monotonic RTP timestamps.')
 finally:track.stop();pool.shutdown()
asyncio.run(test())
