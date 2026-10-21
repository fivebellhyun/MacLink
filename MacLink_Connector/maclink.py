#!/usr/bin/env python3
"""MacLink Connector. User-visible, permission-gated remote desktop host.
No inbound listener. No shell commands are accepted from remote peers.
"""
import argparse, asyncio, concurrent.futures, contextlib, datetime, json, os, platform, signal, ssl, subprocess, sys, time
from pathlib import Path
from fractions import Fraction
from protocol import KEYS, valid
from quality import QualitySettings, prepare_capture
from app_runtime import VERSION, InstanceLock, StatusPublisher, load_config

def agent_request(client, action, url, **kwargs):
 """Bound permission checks without delaying unrelated session mutations."""
 if action=='poll':
  from aiohttp import ClientTimeout
  kwargs['timeout']=ClientTimeout(total=6)
 return client.post(url,**kwargs)

def poll_delay(failures):
 """Space permission checks four seconds apart and back off during outages."""
 if failures:return (4.0,4.0,4.0,4.0,5.0,10.0)[min(failures-1,5)]
 return 4.0

def remaining_poll_delay(interval,started,now):
 """Space request starts by the interval, including time already spent waiting."""
 return max(0.0,interval-max(0.0,now-started))

def session_key(session):
 return (session['id'],session.get('generation',0)) if session else None

class SessionAuthorization:
 """A short permission lease; keeping a peer never extends permission to send."""
 freshness=17
 retention=30
 def __init__(self,clock=time.monotonic):
  self.clock=clock;self.session=None;self.confirmed=None;self.active=False
 def confirm(self,session):
  self.session=session_key(session);self.confirmed=self.clock();self.active=bool(session and session.get('status')=='active')
 def revoke(self):
  self.session=None;self.confirmed=None;self.active=False
 def age(self):
  return float('inf') if self.confirmed is None else max(0,self.clock()-self.confirmed)
 def allows(self,session):
  return self.active and self.session==session_key(session) and self.session is not None and self.age()<self.freshness
 def retain(self,session):
  return self.session is not None and self.session==session_key(session) and self.age()<self.retention

class AgentResponseError(RuntimeError):
 def __init__(self,status,message):
  super().__init__(message);self.status=status

def log_event(event,**fields):
 """Only caller-selected status labels and numbers; never exception text or URLs."""
 stamp=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
 details=' '.join(str(key)+'='+str(value) for key,value in fields.items())
 print('['+stamp+'] '+event+(' '+details if details else ''),flush=True)

async def close_attachment(state,authorization,controller,quality,expected=None,retire=None):
 """Detach before awaiting a peer close, so late teardown cannot clear its replacement."""
 if expected is not None and expected is not state['owner']:return
 old_pc,old_track=state['pc'],state['track'];old_audio=state.get('audio');setting=state['setting']
 old_pcm=state.get('pcm')
 encoding=state.get('encoding')
 state.update(pc=None,session=None,channel=None,ready=False,track=None,audio=None,pcm=None,audio_available=False,audio_error=None,owner=None,paused=False,encoding=None)
 if old_pcm:old_pcm.close()
 if encoding:encoding.close()
 authorization.revoke();controller.release();controller.seq=0;quality.select('balanced')
 if setting and setting is not asyncio.current_task() and not setting.done():setting.cancel()
 if old_track:old_track.stop()
 if old_audio:old_audio.stop()
 if old_pc:
  if retire is not None:retire(old_pc)
  else:await old_pc.close()

class MacInput:
 def __init__(self,q,accessibility):
  self.q=q;self.accessibility=accessibility;self.keys=set();self.buttons=set();self.last_click=0;self.click_count=1;self.last_point=(0,0);self.last_packet=time.monotonic();self.seq=0
 def bounds(self): return self.q.CGDisplayBounds(self.q.CGMainDisplayID())
 def flags(self):
  q=self.q;value=0
  for names,flag in [({'MetaLeft','MetaRight'},q.kCGEventFlagMaskCommand),({'ShiftLeft','ShiftRight'},q.kCGEventFlagMaskShift),({'ControlLeft','ControlRight'},q.kCGEventFlagMaskControl),({'AltLeft','AltRight'},q.kCGEventFlagMaskAlternate)]:
   if self.keys & names:value|=flag
  return value
 def key(self,code,down):
  if down:self.keys.add(code)
  else:self.keys.discard(code)
  ev=self.q.CGEventCreateKeyboardEvent(None,KEYS[code],down)
  self.q.CGEventSetFlags(ev,self.flags());self.q.CGEventPost(self.q.kCGHIDEventTap,ev)
 def pointer(self,e):
  q=self.q;b=self.bounds();point=(b.origin.x+e['x']*max(0,b.size.width-1),b.origin.y+e['y']*max(0,b.size.height-1));button=e.get('button',0);action=e['action']
  types={0:(q.kCGEventLeftMouseDown,q.kCGEventLeftMouseUp,q.kCGEventLeftMouseDragged,q.kCGMouseButtonLeft),2:(q.kCGEventRightMouseDown,q.kCGEventRightMouseUp,q.kCGEventRightMouseDragged,q.kCGMouseButtonRight),1:(q.kCGEventOtherMouseDown,q.kCGEventOtherMouseUp,q.kCGEventOtherMouseDragged,q.kCGMouseButtonCenter)}
  if action=='move':
   button=next(iter(self.buttons),0);kind=types[button][2] if self.buttons else q.kCGEventMouseMoved
  elif action=='down':
   kind=types[button][0];self.buttons.add(button);t=time.monotonic();near=sum((point[i]-self.last_point[i])**2 for i in (0,1))<36;self.click_count=min(3,self.click_count+1) if t-self.last_click<0.4 and near else 1;self.last_click=t;self.last_point=point
  else:kind=types[button][1];self.buttons.discard(button)
  ev=q.CGEventCreateMouseEvent(None,kind,point,types[button][3]);q.CGEventSetFlags(ev,self.flags())
  if action!='move':q.CGEventSetIntegerValueField(ev,q.kCGMouseEventClickState,self.click_count)
  q.CGEventPost(q.kCGHIDEventTap,ev)
 def release(self):
  for code in list(self.keys):self.key(code,False)
  q=self.q;point=q.CGEventGetLocation(q.CGEventCreate(None));b=self.bounds()
  for button in list(self.buttons):self.pointer({'action':'up','button':button,'x':max(0,min(1,(point.x-b.origin.x)/max(1,b.size.width-1))),'y':max(0,min(1,(point.y-b.origin.y)/max(1,b.size.height-1)))})
 def accept(self,e,control):
  if not valid(e):return
  self.last_packet=time.monotonic()
  if e['type']=='ping':return
  if not control or not self.accessibility.AXIsProcessTrusted():return
  if 'seq' in e:
   if not isinstance(e['seq'],int) or e['seq']<=self.seq:return
   self.seq=e['seq']
  q=self.q;t=e['type']
  if t=='release':self.release()
  elif t=='key':self.key(e['code'],e['down'])
  elif t=='pointer':self.pointer(e)
  elif t=='wheel':
   ev=q.CGEventCreateScrollWheelEvent(None,q.kCGScrollEventUnitPixel,2,-round(e['dy']),-round(e['dx']));q.CGEventSetFlags(ev,self.flags());q.CGEventPost(q.kCGHIDEventTap,ev)
  elif t=='text':
   self.release()
   for i in range(0,len(e['text']),20):
    text=e['text'][i:i+20]
    for down in (True,False):
     ev=q.CGEventCreateKeyboardEvent(None,0,down);q.CGEventKeyboardSetUnicodeString(ev,len(text.encode('utf-16-le'))//2,text);q.CGEventPost(q.kCGHIDEventTap,ev)

async def main(config_path,status_path=None):
 if sys.platform!='darwin':raise SystemExit('MacLink Connector requires macOS.')
 import Quartz as Q
 import ApplicationServices as AX
 import aiohttp, certifi, mss
 from PIL import Image
 from media import DesktopVideoTrack,SystemAudioTrack
 from system_audio import available as system_audio_available
 from pcm_audio import CHANNEL_LABEL,SystemPCMSender,install_audio_encoding
 from aiortc import RTCPeerConnection,RTCSessionDescription,RTCConfiguration,RTCIceServer,RTCRtpSender
 from video_encoding import install_video_encoding
 config=load_config(Path(config_path));site=config['site'];device=config['device'];token=config['token']
 from urllib.parse import urlparse
 u=urlparse(site)
 if u.scheme!='https' or u.path not in ('','/') or u.query or u.fragment or u.username:raise SystemExit('The connection address must be the base URL of an HTTPS website.')
 if not all(isinstance(v,str) for v in (device,token)) or len(token)!=64:raise SystemExit('Check the device key file.')
 os.chmod(config_path,0o600)
 lock=InstanceLock(Path(config_path).parent/'agent.lock')
 if not lock.acquire():raise SystemExit('MacLink is already running. Stop the existing Terminal or autostart connector first.')
 print('\nMacLink Connector '+VERSION+'\nDevice: '+str(config.get('name','MacBook'))+'\nStop: use the MacLink menu or press Ctrl+C in this Terminal window\n',flush=True)
 if not Q.CGPreflightScreenCaptureAccess():Q.CGRequestScreenCaptureAccess()
 if not AX.AXIsProcessTrusted():AX.AXIsProcessTrustedWithOptions({AX.kAXTrustedCheckOptionPrompt:True})
 quality=QualitySettings();controller=MacInput(Q,AX);loop=asyncio.get_running_loop();executor=concurrent.futures.ThreadPoolExecutor(max_workers=1);capture_state={}
 def capture():
  if not Q.CGPreflightScreenCaptureAccess():raise RuntimeError('Screen Recording permission is required. Grant permission, then restart the connector.')
  if 'mss' not in capture_state:capture_state['mss']=mss.mss()
  bounds=controller.bounds();region={'left':int(bounds.origin.x),'top':int(bounds.origin.y),'width':int(bounds.size.width),'height':int(bounds.size.height)}
  shot=capture_state['mss'].grab(region);im=Image.frombytes('RGB',shot.size,shot.bgra,'raw','BGRX');return prepare_capture(im,quality.profile)
 audio_supported=system_audio_available()
 state={'session':None,'pc':None,'ready':False,'setting':None,'channel':None,'track':None,'audio':None,'pcm':None,'audio_available':False,'audio_error':None,'owner':None,'paused':False,'encoding':None}
 authorization=SessionAuthorization();notices=set();notice_keys=set();retirements=set();stopping=asyncio.Event()
 publisher=StatusPublisher(status_path) if status_path else None
 status_connection='connecting';status_error='none';reported_session=None
 def report(connection=None,error=None,session=None,update_session=False):
  nonlocal status_connection,status_error,reported_session
  if connection is not None:status_connection=connection
  if error is not None:status_error=error
  if update_session:reported_session=session
  if publisher:
   s=state['session'] or reported_session
   label='paused' if s and state['paused'] else s.get('status','idle') if s else 'idle'
   try:publisher.publish(connection=status_connection,error=status_error,session=label,
                         mode=s.get('mode') if s else None,screen=bool(Q.CGPreflightScreenCaptureAccess()),
                         accessibility=bool(AX.AXIsProcessTrusted()))
   except (OSError,ValueError):log_event('Local status update failed')
 report()

 for sig in (signal.SIGINT,signal.SIGTERM):loop.add_signal_handler(sig,stopping.set)
 caffeinate=subprocess.Popen(['/usr/bin/caffeinate','-di','-w',str(os.getpid())],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 ssl_context=ssl.create_default_context(cafile=certifi.where())
 async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ssl_context),headers={'Authorization':'Bearer '+token,'Accept-Language':'en'},timeout=aiohttp.ClientTimeout(total=12)) as client:
  async def api(action,body=None):
   url=site.rstrip('/')+'/api/agent/'+device+'/'+action
   kwargs={'json':body or {}}
   async with agent_request(client,action,url,**kwargs) as r:
    if r.status in (401,403):
     report(connection='error',error='revoked');stopping.set();authorization.revoke();controller.release()
     if state['track']:state['track'].stop()
     if state['audio']:state['audio'].stop()
     if state['pcm']:state['pcm'].pause()
     raise AgentResponseError(r.status,'The device key has been revoked. Register the device again on the website.')
    if r.status>=500 or r.status==429:raise AgentResponseError(r.status,'Waiting for the server to respond. MacLink will reconnect automatically.')
    data=await r.json()
    if r.status>=400:raise AgentResponseError(r.status,'The server rejected the request.')
    return data
  def current(owner,session,pc=None):
   return not stopping.is_set() and owner is state['owner'] and session_key(session)==session_key(state['session']) and (pc is None or pc is state['pc'])
  def permitted(owner,session,pc=None):
   return current(owner,session,pc) and state['ready'] and not state['paused'] and authorization.allows(session) and Q.CGPreflightScreenCaptureAccess() and (session['mode']!='control' or AX.AXIsProcessTrusted())
  def pause_local():
   if state['session'] and not state['paused']:
    state['paused']=True;controller.release()
    if state['track']:state['track'].pause()
    if state['audio']:state['audio'].pause()
    if state['pcm']:state['pcm'].pause()
    log_event('Authorization paused; peer retained',generation=state['session'].get('generation',0));report()
  def retire_peer(pc):
   async def close_peer():
    try:await pc.close()
    except asyncio.CancelledError:raise
    except Exception as error:log_event('Retired peer cleanup failed',error=type(error).__name__)
   task=asyncio.create_task(close_peer());retirements.add(task);task.add_done_callback(retirements.discard)
  async def close_local(expected=None):
   await close_attachment(state,authorization,controller,quality,expected,retire_peer)
  def notify(action,session,**body):
   # Mutations must not hold the authorization heartbeat behind a 12s request.
   key=(action,session_key(session))
   if key in notice_keys or stopping.is_set():return
   notice_keys.add(key)
   async def send_notice():
    try:await api(action,{'session':session['id'],'generation':session.get('generation',0),**body})
    except asyncio.CancelledError:raise
    except Exception as error:log_event('Server notification failed',action=action,error=type(error).__name__,status=getattr(error,'status',0))
    finally:notice_keys.discard(key)
   task=asyncio.create_task(send_notice());notices.add(task);task.add_done_callback(notices.discard)
  async def setup(s,owner):
   pc=None
   try:
    if not Q.CGPreflightScreenCaptureAccess():raise PermissionError('Screen Recording permission is not enabled on the MacBook.')
    if s['mode']=='control' and not AX.AXIsProcessTrusted():raise PermissionError('Accessibility permission is not enabled on the MacBook.')
    quality.select(s.get('quality','balanced'))
    await loop.run_in_executor(executor,capture)
    if not current(owner,s):return
    pc=RTCPeerConnection(RTCConfiguration(iceServers=[RTCIceServer(urls='stun:stun.cloudflare.com:3478')]))
    state['pc']=pc;controller.seq=0;controller.last_packet=time.monotonic()
    pcm=SystemPCMSender(gate=lambda:quality.name=='ultra' and pc.connectionState=='connected' and permitted(owner,s,pc))
    state['pcm']=pcm
    @pc.on('datachannel')
    def channel_open(channel):
     if not current(owner,s,pc):return
     if channel.label==CHANNEL_LABEL:
      if not pcm.attach(channel):return
      @channel.on('message')
      def audio_message(raw):
       if current(owner,s,pc):pcm.receive(raw)
      @channel.on('close')
      def audio_closed():pcm.detach(channel)
      return
     if channel.label!='control':channel.close();return
     state['channel']=channel
     @channel.on('message')
     def message(raw):
      if not isinstance(raw,str) or len(raw)>16000 or not permitted(owner,s,pc):return
      try:
       event=json.loads(raw)
       if event.get('type')=='ping':controller.last_packet=time.monotonic();channel.send(json.dumps({'type':'pong','t':event.get('t',0)}))
       else:controller.accept(event,s['mode']=='control')
      except Exception:
       if current(owner,s,pc):controller.release()
     @channel.on('close')
     def channel_closed():
      if current(owner,s,pc):controller.release()
    @pc.on('connectionstatechange')
    async def connection_changed():
     if current(owner,s,pc):
      log_event('WebRTC state',state=pc.connectionState,generation=s.get('generation',0))
      if pc.connectionState in ('failed','disconnected','closed'):controller.release();pcm.pause()
    await pc.setRemoteDescription(RTCSessionDescription(sdp=s['offer'],type='offer'))
    if not current(owner,s,pc):return
    track=DesktopVideoTrack(capture,executor,quality.profile.fps,gate=lambda:permitted(owner,s,pc))
    state['track']=track;sender=pc.addTrack(track)
    transceiver=next(item for item in pc.getTransceivers() if item.sender is sender)
    transceiver.setCodecPreferences(sorted(RTCRtpSender.getCapabilities('video').codecs,key=lambda codec:codec.mimeType.lower()!='video/vp8'))
    state['encoding']=install_video_encoding(sender,quality,remote_sdp=pc.remoteDescription.sdp)
    def audio_status(available,error):
     if current(owner,s,pc):
      state['audio_available']=available;state['audio_error']=error
      if not available:pcm.pause()
      log_event('System audio status',available=available,error=error or 'none')
    audio=SystemAudioTrack(gate=lambda:permitted(owner,s,pc),status=audio_status,pcm=pcm.send)
    state['audio']=audio;audio_sender=pc.addTrack(audio)
    audio_transceiver=next(item for item in pc.getTransceivers() if item.sender is audio_sender)
    audio_transceiver.setCodecPreferences([codec for codec in RTCRtpSender.getCapabilities('audio').codecs if codec.mimeType.lower()=='audio/opus'])
    try:install_audio_encoding(audio_sender)
    except Exception as error:log_event('Audio quality tuning unavailable; using default Opus',error=type(error).__name__)
    await pc.setLocalDescription(await pc.createAnswer())
    if not current(owner,s,pc):return
    await api('answer',{'session':s['id'],'generation':s.get('generation',0),'answer':pc.localDescription.sdp})
    if not current(owner,s,pc):return
    state['ready']=True
    log_event('Connection prepared; waiting for authorization',generation=s.get('generation',0))
   except asyncio.CancelledError:raise
   except Exception as error:
    if current(owner,s):
     log_event('Screen setup failed',error=type(error).__name__,status=getattr(error,'status',0),generation=s.get('generation',0))
     notify('end' if isinstance(error,PermissionError) else 'recover',s,**({'reason':'Screen Recording or Accessibility permission is not enabled on the MacBook.'} if isinstance(error,PermissionError) else {}))
     await close_local(owner)
   finally:
    # A cancelled or replaced setup owns only its old peer, never global state.
    if pc is not None and (pc is not state['pc'] or owner is not state['owner']):
     retire_peer(pc)
  async def poll():
   connected=False;failures=0
   while not stopping.is_set():
    poll_started=time.monotonic()
    try:
     screen=bool(Q.CGPreflightScreenCaptureAccess());accessibility=bool(AX.AXIsProcessTrusted())
     info={'screen':screen,'accessibility':accessibility,'version':VERSION,'qualityControl':True,
           'audioSupported':audio_supported,'audioAvailable':bool(state['audio_available'] and state['session'] and authorization.allows(state['session'])),
           'audioError':'permission' if not screen else state['audio_error'] if audio_supported else 'unavailable'}
     if state['session'] and (not screen or (state['session']['mode']=='control' and not accessibility)):
      old_session=state['session'];notify('end',old_session,reason='Screen Recording or Accessibility permission was revoked on the MacBook.')
      await close_local();log_event('Local permission revoked; connection closed')
     if state['ready'] and state['session'] and state['encoding'] and state['encoding'].applied_profile==quality.name:info['quality']={'session':state['session']['id'],'generation':state['session'].get('generation',0),'profile':quality.name}
     poll_started=time.monotonic()
     data=await api('poll',{'info':info});s=data.get('session')
     # Invalidate a capture that crossed an expired lease even when the next
     # successful response arrives before the quarter-second watchdog tick.
     if state['session'] and not authorization.allows(state['session']):pause_local()
     authorization.confirm(s);failures=0
     if not connected:log_event('Connected to the server');connected=True
     if s and s['status'] in ('approved','active') and (not Q.CGPreflightScreenCaptureAccess() or (s['mode']=='control' and not AX.AXIsProcessTrusted())):
      notify('end',s,reason='Screen Recording or Accessibility permission was revoked on the MacBook.')
      await close_local();s=None
     if s and state['session'] and session_key(s)!=session_key(state['session']):
      await close_local();authorization.confirm(s)
     if not s:
      if state['session'] or state['pc']:
       await close_local();log_event('Connection ended; waiting for a new connection')
     elif s['status']=='approved' and not state['pc'] and (state['setting'] is None or state['setting'].done()):
      owner=object();state.update(owner=owner,session=s,paused=False)
      state['setting']=asyncio.create_task(setup(s,owner))
     elif s['status']=='active':
      if not state['session'] or (not state['pc'] and not state['ready']):
       notify('recover',s)
      else:
       state['session']=s;quality.select(s.get('quality','balanced'),state['track'])
       if state['pcm']:state['pcm'].sync()
       if state['paused']:
        state['paused']=False
        if state['track']:state['track'].resume()
        if state['audio']:state['audio'].resume()
        log_event('Authorization restored; existing peer resumed',generation=s.get('generation',0))
     report(connection='online',error='none',session=s,update_session=True)
    except asyncio.CancelledError:raise
    except Exception as error:
     connected=False
     transient=isinstance(error,(aiohttp.ClientError,asyncio.TimeoutError,ConnectionError)) or getattr(error,'status',0)==429 or getattr(error,'status',0)>=500
     failures=failures+1 if transient else 0
     log_event('Status poll failed',error=type(error).__name__,status=getattr(error,'status',0),failures=failures)
     report(connection='error' if getattr(error,'status',0) in (401,403) else 'reconnecting',error='revoked' if getattr(error,'status',0) in (401,403) else 'network')
    delay=poll_delay(failures)
    await asyncio.sleep(remaining_poll_delay(delay,poll_started,time.monotonic()))
  async def watchdog():
   while not stopping.is_set():
    if time.monotonic()-controller.last_packet>1.5:controller.release()
    session=state['session']
    if session:
     if not Q.CGPreflightScreenCaptureAccess() or (session['mode']=='control' and not AX.AXIsProcessTrusted()):
      notify('end',session,reason='Screen Recording or Accessibility permission was revoked on the MacBook.')
      await close_local();log_event('Local permission revoked; connection closed')
     elif not authorization.allows(session):
      pause_local()
      if not authorization.retain(session):
       await close_local();log_event('Authorization recovery timed out; peer closed')
    report()
    await asyncio.sleep(0.25)
  tasks=[asyncio.create_task(poll()),asyncio.create_task(watchdog())]
  log_event('Connecting to the server',screen=bool(Q.CGPreflightScreenCaptureAccess()),input=bool(AX.AXIsProcessTrusted()))
  try:await stopping.wait()
  finally:
   old_session=state['session'];authorization.revoke();controller.release()
   if state['track']:state['track'].stop()
   if state['audio']:state['audio'].stop()
   if state['pcm']:state['pcm'].pause()
   for task in tasks+[state['setting']]+list(notices):
    if task:task.cancel()
   await asyncio.gather(*(task for task in tasks+[state['setting']]+list(notices) if task),return_exceptions=True)
   await close_local()
   if retirements:
    with contextlib.suppress(asyncio.TimeoutError):await asyncio.wait_for(asyncio.gather(*list(retirements),return_exceptions=True),5)
   if old_session:
    with contextlib.suppress(Exception):await api('recover',{'session':old_session['id'],'generation':old_session.get('generation',0)})
   caffeinate.terminate();executor.shutdown(wait=False,cancel_futures=True);log_event('MacLink stopped; all input keys released')
   report(connection='error' if status_error=='revoked' else 'stopped',session=None,update_session=True)
   lock.release()

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
 try:asyncio.run(main(args.config))
 except KeyboardInterrupt:pass
