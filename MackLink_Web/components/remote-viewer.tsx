
'use client';
import {useEffect,useRef,useState} from 'react';
import {Monitor, MousePointer2, Maximize, Power, Keyboard, Send, X, LoaderCircle, Eye, ShieldCheck, Settings2, Volume2, VolumeX} from 'lucide-react';
import {PcmAudioPlayer,PCM_READY,PCM_DISABLED,pcmSignal,supportsPcmAudio} from '@/lib/pcm-audio';
import {HostAudioControl} from '@/lib/host-audio-control';
import {PointerMoveScheduler} from '@/lib/pointer-move-scheduler';
import {RemoteSettings} from '@/components/remote-settings';
import {useLocale} from '@/components/locale-provider';
import {ScreenFrameBuffer,watchVideoFrames,canRetryLivePoll} from '@/lib/screen-continuity';
import {ConnectionDiagnostics,buildConnectionReport} from '@/lib/connection-diagnostics';
import {KeyboardMapper,DEFAULT_KEYBOARD_MAPPING,readKeyboardMapping,writeKeyboardMapping,type KeyboardMapping} from '@/lib/keyboard-mapping';
import {DEFAULT_VIDEO_QUALITY,QUALITY_PROFILES,isVideoQuality,qualityProfileLabel,qualityProfileDescription,type VideoQuality} from '@/lib/quality';
import {CONNECTOR_RELEASES_URL,CONNECTOR_DOWNLOAD_URL} from '@/lib/connector-download';
import {createPeer,makeOffer,describeRoute,rememberConnection,forgetConnection,type StoredConnection,type IceConfig,type ConnectionMode} from '@/lib/remote-client';
export type RemoteSession=StoredConnection&{peer?:RTCPeerConnection;channel?:RTCDataChannel;pcmChannel?:RTCDataChannel;iceConfig?:IceConfig};
export function RemoteViewer({session:s,onEnd}:{session:RemoteSession;onEnd:(reason:string)=>void}){
 const {locale,t}=useLocale();
 const localeRef=useRef(locale);localeRef.current=locale;
 const held=useRef<HTMLCanvasElement>(null),picture=useRef<ScreenFrameBuffer|undefined>(undefined),live=useRef(false),stopVideoFrames=useRef<()=>void>(()=>{}),lastSnapshot=useRef(0),inputBlocked=useRef(false),lastConfirmed=useRef(0);
 const [hasFrame,setHasFrame]=useState(false),[checking,setChecking]=useState(false);
 const audio=useRef<HTMLAudioElement>(null),soundOn=useRef(false),hostAudio=useRef(new HostAudioControl());
 const [hostAudioEnabled,setHostAudioEnabled]=useState<boolean|null>(null);
 const pcm=useRef<PcmAudioPlayer|null>(null),pcmChannel=useRef(s.pcmChannel),lastPcmReady=useRef(0),qualityValue=useRef<VideoQuality>(DEFAULT_VIDEO_QUALITY),appliedValue=useRef<VideoQuality|null>(null);
 const [pcmCapable,setPcmCapable]=useState(false),[pcmAvailable,setPcmAvailable]=useState(false),[pcmPhase,setPcmPhase]=useState('idle'),[pcmNote,setPcmNote]=useState(''),[opusPlaying,setOpusPlaying]=useState(false);
 useEffect(()=>setPcmCapable(supportsPcmAudio()),[]);
 const [soundEnabled,setSoundEnabled]=useState(false),[hasAudio,setHasAudio]=useState(false),[audioBlocked,setAudioBlocked]=useState(false),[audioSupported,setAudioSupported]=useState<boolean|null>(null),[audioError,setAudioError]=useState('');
 const diagnostics=useRef(new ConnectionDiagnostics()),connectorVersion=useRef<string|null>(null);
 function connectionReport(){return buildConnectionReport(diagnostics.current,peer.current,{mode:connectionMode.current,generation:generation.current,connectorVersion:connectorVersion.current,lastStatusAgeMs:lastConfirmed.current?performance.now()-lastConfirmed.current:null,dataChannelState:channel.current?.readyState});}
 function frameBuffer(){if(!picture.current&&held.current)picture.current=new ScreenFrameBuffer(held.current);return picture.current;}
 function snapshot(){
  const buffer=frameBuffer();if(!buffer||!live.current)return;
  const source=video.current;
  const w=video.current?.videoWidth,h=video.current?.videoHeight;
  const stream=video.current?.srcObject,healthyVideo=peer.current?.connectionState==='connected'&&video.current?.readyState!==undefined&&video.current.readyState>=2&&stream instanceof MediaStream&&stream.getVideoTracks().some(track=>track.readyState==='live'&&!track.muted);
  if(source&&w&&h&&healthyVideo&&buffer.capture(source,w,h))setHasFrame(true);
 }
 function holdScreen(){stopPcm();pauseOpus();if(live.current)diagnostics.current.record('video-held',{generation:generation.current});snapshot();frameBuffer()?.show();releaseInput();live.current=false;setReady(false);setLatency(null);}
 const keyboard=useRef(new KeyboardMapper()),mapping=useRef<KeyboardMapping>({...DEFAULT_KEYBOARD_MAPPING});
 const [settingsOpen,setSettingsOpen]=useState(false),[keyboardMapping,setKeyboardMapping]=useState<KeyboardMapping>({...DEFAULT_KEYBOARD_MAPPING}),[keyboardSaved,setKeyboardSaved]=useState(true);
 useEffect(()=>{try{const saved=readKeyboardMapping(localStorage);mapping.current=saved;setKeyboardMapping(saved);}catch{setKeyboardSaved(false);}},[]);
 function releaseInput(){send({type:'release'});focused.current=false;setInputOn(false);}
 function changeKeyboardMapping(value:KeyboardMapping){releaseInput();mapping.current={...value};setKeyboardMapping({...value});try{setKeyboardSaved(writeKeyboardMapping(localStorage,value));}catch{setKeyboardSaved(false);}}
 function openSettings(){releaseInput();setTextOpen(false);setSettingsOpen(true);}
 const video=useRef<HTMLVideoElement>(null),surface=useRef<HTMLDivElement>(null),closed=useRef(false),active=useRef(false),focused=useRef(false),seq=useRef(0),answered=useRef(0);
 const peer=useRef(s.peer),channel=useRef(s.channel),generation=useRef(s.generation||0),needsResume=useRef(!s.peer),restarting=useRef(false),disconnectedAt=useRef(0),lifecycle=useRef(0);
 const pointerMoves=useRef<PointerMoveScheduler<any>|null>(null);
 if(!pointerMoves.current)pointerMoves.current=new PointerMoveScheduler(event=>{if(!active.current||!live.current||inputBlocked.current||closed.current||s.mode!=='control'||!focused.current)return true;return transmitInput(event,true);});
 const ice=useRef(s.iceConfig),connectionMode=useRef<ConnectionMode>(s.connectionMode==='tls'?'tls':'auto'),tlsTried=useRef(s.connectionMode==='tls');
 const [networkNote,setNetworkNote]=useState(s.iceConfig?.warning||'');
 const qualityRevision=useRef(0),qualityPending=useRef(false);
 const [quality,setQuality]=useState<VideoQuality>(DEFAULT_VIDEO_QUALITY),[qualityApplied,setQualityApplied]=useState<VideoQuality|null>(null),[qualitySupported,setQualitySupported]=useState<boolean|null>(null),[qualitySaving,setQualitySaving]=useState(false),[qualityError,setQualityError]=useState('');
 const [status,setStatus]=useState(s.status==='approved'?'자동 연결 중':'연결 준비'),[transport,setTransport]=useState('연결 준비'),[ready,setReady]=useState(false),[inputOn,setInputOn]=useState(false),[textOpen,setTextOpen]=useState(false),[text,setText]=useState(''),[problem,setProblem]=useState(''),[dimensions,setDimensions]=useState(''),[latency,setLatency]=useState<number|null>(null);
 async function req(path:string,method='GET',body?:unknown){const r=await fetch('/api/sessions/'+s.id+path,{method,credentials:'same-origin',headers:{'Accept-Language':localeRef.current,Authorization:'Bearer '+s.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(path===''?3000:10000)});if(!r.ok){const d:any=await r.json().catch(()=>null);throw Object.assign(new Error(d?.error||'HTTP '+r.status),{status:r.status});}return r;}
 async function changeQuality(value:string){
  if(!isVideoQuality(value)||!qualitySupported||qualityPending.current||restarting.current||closed.current)return;
  qualityPending.current=true;const revision=++qualityRevision.current,g=generation.current;
  send({type:'release'});focused.current=false;setInputOn(false);setQualitySaving(true);setQualityError('');qualityValue.current=value;appliedValue.current=null;stopPcm(true);setQuality(value);setQualityApplied(null);
  try{await req('/quality','POST',{quality:value,generation:g});}
  catch(e){if(!closed.current&&revision===qualityRevision.current)setQualityError((e as Error).message);}
  finally{if(revision===qualityRevision.current){qualityPending.current=false;if(!closed.current)setQualitySaving(false);}}
 }
 function updateDimensions(){if(video.current?.videoWidth&&video.current.videoHeight)setDimensions(video.current.videoWidth+' × '+video.current.videoHeight);}
 function pauseOpus(){if(audio.current){audio.current.muted=true;audio.current.pause();}setOpusPlaying(false);}
 function pcmAllowed(){return soundOn.current&&live.current&&active.current&&!inputBlocked.current&&!closed.current&&qualityValue.current==='ultra'&&appliedValue.current==='ultra';}
 function syncHostAudio(){hostAudio.current.sync(soundOn.current);setHostAudioEnabled(hostAudio.current.acknowledged);}
 function syncPcmReady(){
  const player=pcm.current,c=pcmChannel.current;if(!player?.prepared||!pcmAllowed()||c?.readyState!=='open'||c.bufferedAmount>1024)return;
  const now=Date.now();if(now-lastPcmReady.current<1000)return;lastPcmReady.current=now;try{c.send(PCM_READY);player.expectPackets(now);}catch{stopPcm(true);}
 }
 function stopPcm(fallback=false,note=''){
  const player=pcm.current;pcm.current=null;player?.close();lastPcmReady.current=0;
  const c=pcmChannel.current;if(player&&c?.readyState==='open')try{c.send(PCM_DISABLED);}catch{}
  setPcmPhase('idle');if(note)setPcmNote(note);if(fallback)playAudio();
 }
 function startPcmFromGesture(){
  if(!pcmCapable||pcm.current||pcmChannel.current?.readyState!=='open'||!soundOn.current)return;
  setPcmNote('');setPcmPhase('starting');
  const player=new PcmAudioPlayer({beforePlay:()=>{if(pcm.current!==player||!pcmAllowed())return false;pauseOpus();return true;},onPlaying:()=>{if(pcm.current===player&&pcmAllowed())setPcmPhase('playing');else stopPcm(true);},onBuffering:()=>{if(pcm.current!==player)return;if(pcmAllowed())setPcmPhase('buffering');else stopPcm();},onFailure:reason=>{
   if(pcm.current!==player)return;const c=pcmChannel.current;const note=reason==='blocked'?'PCM 소리를 재생하려면 소리 버튼을 다시 눌러 주세요.':reason==='timeout'?'PCM 소리가 도착하지 않아 일반 소리로 전환합니다.':reason==='starvation'||reason==='backlog'?'PCM 소리 전송이 지연되어 일반 소리로 전환합니다.':'PCM 소리를 사용할 수 없습니다. 일반 소리로 전환합니다.';stopPcm(true,note);if(reason==='invalid'){setPcmAvailable(false);c?.close();}
  }});pcm.current=player;void player.startFromGesture().then(()=>{if(pcm.current===player&&player.prepared){setPcmPhase('ready');syncPcmReady();}});
 }
 function bindPcm(p:RTCPeerConnection,c?:RTCDataChannel){
  if(pcmChannel.current!==c)stopPcm();pcmChannel.current=c;hostAudio.current.bind(c??null);setHostAudioEnabled(null);setPcmAvailable(c?.readyState==='open');syncHostAudio();if(!c)return;c.binaryType='arraybuffer';
  c.onopen=()=>{if(peer.current===p&&pcmChannel.current===c&&!closed.current){setPcmAvailable(true);syncHostAudio();syncPcmReady();}};
  c.onclose=()=>{if(peer.current===p&&pcmChannel.current===c&&!closed.current){hostAudio.current.bind(null);setHostAudioEnabled(null);setPcmAvailable(false);stopPcm(true);}};
  c.onmessage=event=>{if(peer.current!==p||pcmChannel.current!==c||closed.current)return;
   if(typeof event.data==='string'){if(hostAudio.current.receive(event.data)){setHostAudioEnabled(hostAudio.current.acknowledged);return;}try{if(pcmSignal(event.data)==='opus'&&pcm.current){if(pcmAllowed()){pcm.current.rebuffer();lastPcmReady.current=0;syncPcmReady();}else stopPcm();}}catch{if(pcm.current){stopPcm(true,'PCM 소리를 사용할 수 없습니다. 일반 소리로 전환합니다.');setPcmAvailable(false);c.close();}}return;}
   if(pcmAllowed())pcm.current?.receive(event.data);
  };
 }
 function playAudio(){
  syncPcmReady();const element=audio.current;
  if(!element||!element.srcObject||!element.paused||pcm.current?.ownsOutput||!soundOn.current||!live.current||!active.current||inputBlocked.current||closed.current)return;
  const stream=element.srcObject;element.muted=false;
  void element.play().then(()=>{if(audio.current===element&&element.srcObject===stream&&!closed.current&&!pcm.current?.ownsOutput&&!element.paused&&soundOn.current&&live.current&&!inputBlocked.current){setAudioBlocked(false);setOpusPlaying(true);}}).catch(()=>{if(audio.current===element&&element.srcObject===stream&&!closed.current&&soundOn.current&&live.current&&!inputBlocked.current&&!pcm.current?.ownsOutput)setAudioBlocked(true);});
 }
 function toggleAudio(){
  soundOn.current=audioBlocked||!soundOn.current;setSoundEnabled(soundOn.current);syncHostAudio();if(soundOn.current){playAudio();}else{stopPcm();pauseOpus();setAudioBlocked(false);}
 }
 function clearAudio(){stopPcm();pauseOpus();if(audio.current)audio.current.srcObject=null;setHasAudio(false);setAudioBlocked(false);}
 function closeTransport(){pointerMoves.current?.cancel();hostAudio.current.bind(null);setHostAudioEnabled(null);holdScreen();clearAudio();stopVideoFrames.current();keyboard.current.reset();active.current=false;focused.current=false;disconnectedAt.current=0;setInputOn(false);setReady(false);if(peer.current){peer.current.onconnectionstatechange=null;peer.current.oniceconnectionstatechange=null;peer.current.ontrack=null;peer.current.close();}peer.current=undefined;channel.current=undefined;if(video.current)video.current.srcObject=null;}
 async function end(reason='연결이 종료되었습니다.',remote=false){if(closed.current)return;diagnostics.current.record('session-end',{generation:generation.current,reason:remote?'authorization-ended':'viewer-closed'});send({type:'release'});closed.current=true;closeTransport();picture.current?.clear();setHasFrame(false);forgetConnection();if(!remote){try{await req('/end','POST',{});}catch{}}onEnd(reason);}
 function transmitInput(e:any,move=false){
  const c=channel.current;if(c?.readyState!=='open')return false;
  const message=JSON.stringify({...e,seq:seq.current+1}),bytes=e.type==='text'?new TextEncoder().encode(message).byteLength:message.length;
  if(move&&c.bufferedAmount+bytes>4096)return false;
  // Closing a saturated control channel makes the host release held input.
  if(c.bufferedAmount+bytes>65536){c.close();holdScreen();disconnectedAt.current=Date.now();setProblem('입력 전송이 지연되어 연결을 다시 준비합니다.');return false;}
  try{c.send(message);seq.current++;return true;}catch{c.close();holdScreen();disconnectedAt.current=Date.now();return false;}
 }
 function send(e:any){
  if(e.type==='release'){keyboard.current.reset();pointerMoves.current?.cancel();}
  if(!active.current||s.mode!=='control'||((!live.current||inputBlocked.current)&&!['release','ping'].includes(e.type)))return;
  if(e.type==='pointer'&&e.action==='move'){pointerMoves.current?.enqueue(e);return;}
  pointerMoves.current?.flush();transmitInput(e);
 }
 function tryNextTransport(){
  if(closed.current||!active.current||restarting.current)return;
  diagnostics.current.record('transport',{generation:generation.current,reason:'ice-timeout'});
  if(ice.current?.tls443&&!tlsTried.current){tlsTried.current=true;void reconnect(generation.current,'tls');return;}
  void end(ice.current?.turnEnabled?'직접 연결과 TURN 연결에 실패했습니다. 네트워크 설정을 확인한 뒤 다시 접속해 주세요.':'직접 연결에 실패했습니다. 호스트의 연결 설정에서 TURN을 등록하거나 다른 네트워크를 사용해 주세요.');
 }
 async function updateRoute(p:RTCPeerConnection){try{const label=await describeRoute(p);if(peer.current===p&&!closed.current)setTransport(label);}catch{}}
 function wire(p:RTCPeerConnection,c:RTCDataChannel,pc?:RTCDataChannel){
  bindPcm(p,pc);
  p.ontrack=e=>{
   if(peer.current!==p||closed.current)return;
   if(e.track.kind==='audio'){
    if(!audio.current)return;
    const element=audio.current,stream=new MediaStream([e.track]);element.pause();element.muted=true;setOpusPlaying(false);element.srcObject=stream;setHasAudio(true);setAudioError('');
    e.track.onended=()=>{if(peer.current===p&&element.srcObject===stream&&!closed.current)clearAudio();};
    playAudio();return;
   }
   if(e.track.kind!=='video'||!video.current)return;
   holdScreen();stopVideoFrames.current();
   const element=video.current,stream=new MediaStream([e.track]);element.srcObject=stream;
   const run=lifecycle.current;
   stopVideoFrames.current=watchVideoFrames(element,{
    isCurrent:()=>!closed.current&&run===lifecycle.current&&peer.current===p&&element.srcObject===stream,
    onFrame:time=>{
     if(p.connectionState!=='connected'||c.readyState!=='open'||e.track.muted||e.track.readyState!=='live'||navigator.onLine===false||restarting.current||needsResume.current)return;
     if(!live.current||time-lastSnapshot.current>=250){
      const buffer=frameBuffer();if(buffer?.capture(element,element.videoWidth,element.videoHeight))setHasFrame(true);lastSnapshot.current=time;
     }
     if(!live.current){diagnostics.current.record('video-live',{generation:generation.current});live.current=true;setReady(true);setProblem('');frameBuffer()?.hide();playAudio();}
    },
   });
   e.track.onmute=()=>{if(peer.current===p&&video.current?.srcObject===stream&&stream.getVideoTracks().includes(e.track)&&!closed.current)holdScreen();};
   e.track.onended=()=>{if(peer.current===p&&video.current?.srcObject===stream&&stream.getVideoTracks().includes(e.track)&&!closed.current){holdScreen();disconnectedAt.current=Date.now();}};
   void element.play().catch(()=>setProblem('화면 재생을 기다리고 있습니다.'));
  };
  p.onconnectionstatechange=()=>{
   if(peer.current!==p||closed.current)return;
   diagnostics.current.record('peer-state',{generation:generation.current,state:p.connectionState});
   if(p.connectionState==='connected'){disconnectedAt.current=0;setTransport('WebRTC · 경로 확인 중');setStatus('연결됨 · 시간 제한 없음');void updateRoute(p);}
   if(p.connectionState==='disconnected'){holdScreen();disconnectedAt.current=Date.now();}
   if(p.connectionState==='failed'){holdScreen();tryNextTransport();}
  };
  p.oniceconnectionstatechange=()=>{if(peer.current===p&&!closed.current)diagnostics.current.record('ice-state',{generation:generation.current,state:p.iceConnectionState});};
  c.onopen=()=>{if(peer.current===p&&!closed.current)diagnostics.current.record('data-channel',{generation:generation.current,state:'open'});};
  c.onclose=()=>{if(peer.current===p&&!closed.current){diagnostics.current.record('data-channel',{generation:generation.current,state:'closed',reason:'channel-closed'});holdScreen();disconnectedAt.current=Date.now();}};
  c.onmessage=e=>{if(channel.current!==c)return;try{const msg=JSON.parse(e.data);if(msg.type==='pong'&&live.current)setLatency(Math.round(performance.now()-msg.t));}catch{}};
 }
 async function reconnect(serverGeneration:number,preferred:ConnectionMode=connectionMode.current){
  if(restarting.current||closed.current)return;restarting.current=true;const run=lifecycle.current;
  diagnostics.current.record('reconnect',{generation:serverGeneration,reason:'resume'});
  send({type:'release'});closeTransport();answered.current=0;seq.current=0;
  setStatus(preferred==='tls'?'TURN/TLS 443 경로로 연결하고 있습니다':'자동으로 다시 연결하고 있습니다');setTransport('재연결 중');
  let pair:ReturnType<typeof createPeer>|undefined;
  try{
   const config:IceConfig=await (await req('/ice')).json();if(closed.current||run!==lifecycle.current)return;
   ice.current=config;setNetworkNote(config.warning||'');
   pair=createPeer(config,preferred);peer.current=pair.peer;channel.current=pair.channel;connectionMode.current=preferred;tlsTried.current=preferred==='tls';wire(pair.peer,pair.channel,pair.pcmChannel);
   const offer=await makeOffer(pair.peer);if(closed.current||run!==lifecycle.current){pair.peer.close();return;}
   const r=await req('/resume','POST',{offer,generation:serverGeneration});const d:any=await r.json();
   if(closed.current||run!==lifecycle.current){pair.peer.close();return;}
   generation.current=d.generation;needsResume.current=false;rememberConnection({...s,generation:d.generation,status:d.status,connectionMode:preferred});
  }catch(e){pair?.peer.close();if(run===lifecycle.current&&!closed.current){needsResume.current=true;peer.current=undefined;setProblem((e as Error).message);setStatus('연결 복구 대기 · 자동 재시도');}}
  finally{restarting.current=false;}
 }
 useEffect(()=>{
  closed.current=false;const run=++lifecycle.current;let timer:ReturnType<typeof setTimeout>,pingTimer:ReturnType<typeof setInterval>,routeTimer:ReturnType<typeof setInterval>,polling=false,retrySoon=false;
  if(peer.current&&channel.current)wire(peer.current,channel.current,pcmChannel.current);rememberConnection(s);
  async function poll(){if(closed.current||polling||run!==lifecycle.current)return;polling=true;const qualityRequestRevision=qualityRevision.current,pollGeneration=generation.current,pollPeer=peer.current;try{const r=await req('');const d:any=await r.json();if(closed.current||run!==lifecycle.current)return;if(d.status==='ended'){void end(d.reason||'접속 권한이 종료되었습니다.',true);return;}if(pollGeneration!==generation.current||pollPeer!==peer.current)return;if(!lastConfirmed.current||inputBlocked.current)diagnostics.current.record('status-ok',{generation:generation.current});connectorVersion.current=d.connectorVersion??null;setAudioSupported(d.audioSupported===true);setAudioError(typeof d.audioError==='string'&&d.audioError!=='initializing'?d.audioError:'');lastConfirmed.current=performance.now();inputBlocked.current=false;setChecking(false);retrySoon=false;setProblem('');playAudio();
    if(qualityRequestRevision===qualityRevision.current&&!qualityPending.current){setQualitySupported(d.qualitySupported===true);if(isVideoQuality(d.quality)){qualityValue.current=d.quality;setQuality(d.quality);}appliedValue.current=isVideoQuality(d.qualityApplied)?d.qualityApplied:null;setQualityApplied(appliedValue.current);if(qualityValue.current!=='ultra'&&pcm.current)stopPcm(true);syncPcmReady();}
    // Keep the authorization heartbeat running while ICE gathering awaits blocked endpoints.
    if(restarting.current)return;
    if(d.status==='reconnecting'||needsResume.current||d.generation!==generation.current){void reconnect(d.generation);return;}
    active.current=d.status==='active';setStatus(d.status==='approved'?(connectionMode.current==='tls'?'TURN/TLS 443 연결 준비 중':'자동 연결 중'):'연결 중 · 시간 제한 없음');
    if(d.answer&&!answered.current&&peer.current){const answerPeer=peer.current;await answerPeer.setRemoteDescription({type:'answer',sdp:d.answer});if(closed.current||run!==lifecycle.current||pollGeneration!==generation.current||answerPeer!==peer.current)return;answered.current=Date.now();}
    if(active.current&&ice.current?.expiresAt&&Date.now()>ice.current.expiresAt-300000){void reconnect(d.generation);return;}
    if(active.current&&((answered.current&&Date.now()-answered.current>(ice.current?.turnEnabled?25000:15000)&&(peer.current?.connectionState!=='connected'||channel.current?.readyState!=='open'))||(disconnectedAt.current&&Date.now()-disconnectedAt.current>5000)))tryNextTransport();
   }catch(e){if(!closed.current&&run===lifecycle.current){if([401,403,404].includes((e as Error&{status?:number}).status||0)){void end((e as Error).message,true);return;}if(pollGeneration!==generation.current||pollPeer!==peer.current)return;const httpStatus=(e as Error&{status?:number}).status;diagnostics.current.record('status-error',{generation:generation.current,httpStatus});if(canRetryLivePoll(httpStatus,lastConfirmed.current,performance.now(),active.current&&peer.current?.connectionState==='connected'&&channel.current?.readyState==='open')){releaseInput();inputBlocked.current=true;stopPcm();pauseOpus();setChecking(true);retrySoon=true;}else{retrySoon=false;needsResume.current=true;send({type:'release'});closeTransport();setProblem((e as Error).message);setStatus('네트워크 복구 대기 · 자동 재시도');}}}
   finally{polling=false;if(!closed.current&&run===lifecycle.current)timer=setTimeout(poll,retrySoon?500:needsResume.current?4000:2000);}}
  pingTimer=setInterval(()=>{syncHostAudio();syncPcmReady();pcm.current?.watchdog();if(active.current&&channel.current?.readyState==='open'&&channel.current.bufferedAmount<1024)try{channel.current.send(JSON.stringify({type:'ping',t:performance.now()}));}catch{}},500);
  routeTimer=setInterval(()=>{if(peer.current?.connectionState==='connected')void updateRoute(peer.current);},2000);
  const release=()=>{send({type:'release'});focused.current=false;setInputOn(false);};const hidden=()=>{if(document.hidden)release();else{clearTimeout(timer);void poll();}};
  const offline=()=>{diagnostics.current.record('network',{reason:'network-offline'});holdScreen();inputBlocked.current=true;setChecking(true);setStatus('네트워크 복구 대기 · 자동 재시도');};
  const unload=()=>{release();stopPcm();pauseOpus();peer.current?.close();};const online=()=>{diagnostics.current.record('network',{reason:'network-online'});clearTimeout(timer);void poll();};
  window.addEventListener('blur',release);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',unload);window.addEventListener('online',online);window.addEventListener('offline',offline);
  void poll();return()=>{closed.current=true;pointerMoves.current?.cancel();hostAudio.current.bind(null);++lifecycle.current;clearTimeout(timer);clearInterval(pingTimer);clearInterval(routeTimer);window.removeEventListener('blur',release);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',unload);window.removeEventListener('online',online);window.removeEventListener('offline',offline);stopVideoFrames.current();picture.current?.clear();stopPcm();peer.current?.close();if(audio.current){audio.current.pause();audio.current.srcObject=null;}if(video.current)video.current.srcObject=null;};
 },[]);
 const coords=(e:React.PointerEvent)=>{const el=video.current;if(!el)return null;const r=el.getBoundingClientRect();const w=video.current!.videoWidth,h=video.current!.videoHeight;if(!w||!h)return null;const scale=Math.min(r.width/w,r.height/h);const left=r.left+(r.width-w*scale)/2,top=r.top+(r.height-h*scale)/2;const x=(e.clientX-left)/(w*scale),y=(e.clientY-top)/(h*scale);return{x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),inside:x>=0&&x<=1&&y>=0&&y<=1};};
 function pointer(e:React.PointerEvent,action:string){if(!ready||!live.current||inputBlocked.current||s.mode!=='control'||settingsOpen)return;const c=coords(e);if(!c||(!c.inside&&action==='down'))return;e.preventDefault();if(action==='down'){surface.current?.focus();surface.current?.setPointerCapture(e.pointerId);focused.current=true;setInputOn(true);}if(!focused.current)return;for(const event of keyboard.current.modifiers(e,mapping.current))send(event);send({type:'pointer',action,x:c.x,y:c.y,button:e.button<0?0:e.button});if(action==='up'&&surface.current?.hasPointerCapture(e.pointerId))surface.current.releasePointerCapture(e.pointerId);}
 function key(e:React.KeyboardEvent,down:boolean){if(s.mode!=='control'||!live.current||inputBlocked.current||!focused.current||settingsOpen)return;if(e.nativeEvent.isComposing){if(!down)for(const event of keyboard.current.key(e.code,false,mapping.current))send(event);return;}e.preventDefault();if(e.code==='Escape'&&e.shiftKey){releaseInput();surface.current?.blur();return;}for(const event of keyboard.current.event(e,down,mapping.current))send(event);}
 function shortcut(code:string){if(!ready||!live.current||inputBlocked.current)return;releaseInput();send({type:'key',code:'MetaLeft',down:true});send({type:'key',code,down:true});send({type:'key',code,down:false});send({type:'key',code:'MetaLeft',down:false});}
 return <div className="remote-overlay"><header className="remote-toolbar"><div className="remote-title"><Monitor size={19}/><div><strong>{s.name}</strong><small title={t(problem||status)}><span className={'dot '+(ready&&!checking?'green':'')}/>{t(hasFrame&&!ready?'연결 복구 중 · 마지막 화면 유지':checking?'연결 상태 확인 중':ready?transport:status)}{latency!==null?' · '+latency+' ms':''}{dimensions?' · '+dimensions:''}</small></div></div><div className="remote-tools"><label className="quality-picker" title={t('송출 해상도와 목표 프레임 수를 조절합니다. 실제 크기는 맥 화면과 연결 상태에 따라 달라집니다.')+' '+qualityProfileDescription(QUALITY_PROFILES.find(p=>p.id===quality)!,t)}><span>{t('화질')}</span><select aria-label={t('원격 화면 화질')} value={quality} disabled={!qualitySupported||qualityPending.current||restarting.current} onChange={e=>void changeQuality(e.target.value)}>{QUALITY_PROFILES.map(p=><option key={p.id} value={p.id}>{qualityProfileLabel(p,t)}</option>)}</select><small aria-live="polite">{t(qualitySaving?'전달 중':qualitySupported&&qualityApplied!==quality?'적용 중':qualitySupported?'적용됨':'')}</small></label><button className={audioBlocked?'audio-blocked':''} onClick={toggleAudio} disabled={!hasAudio||!ready||checking} aria-pressed={soundEnabled&&!audioBlocked} title={t(audioBlocked?'소리를 재생하려면 눌러 주세요.':hasAudio?soundEnabled?'소리 끄기':'소리 켜기':audioSupported===false?'시스템 소리를 지원하는 연결 프로그램이 필요합니다.':'시스템 소리 대기 중')}><span aria-hidden="true">{soundEnabled&&!audioBlocked?<Volume2 size={17}/>:<VolumeX size={17}/>}</span><span>{t(audioBlocked?'소리 켜기':hasAudio?soundEnabled?'소리 끄기':'소리 켜기':'시스템 소리')}</span></button>{quality==='ultra'&&pcmCapable&&pcmAvailable&&soundEnabled&&!pcm.current&&<button onClick={startPcmFromGesture} disabled={!ready||checking} title={t('PCM 소리 켜기')}>{t('PCM 소리 켜기')}</button>}<small className="audio-format" aria-live="polite">{pcmPhase==='playing'?t('PCM 48kHz 스테레오'):pcmPhase==='buffering'?t('PCM 버퍼링 중'):opusPlaying?'Opus':''}</small>{s.mode==='control'&&<><button title={t('맥에서 복사')} onClick={()=>shortcut('KeyC')} disabled={!ready||checking}>⌘C</button><button title={t('맥에서 붙여넣기')} onClick={()=>shortcut('KeyV')} disabled={!ready||checking}>⌘V</button><button title={t('맥 앱 전환')} onClick={()=>shortcut('Tab')} disabled={!ready||checking}>⌘Tab</button><button onClick={()=>{send({type:'release'});focused.current=false;setInputOn(false);setTextOpen(!textOpen);}} disabled={!ready||checking}><Keyboard size={17}/><span>{t('텍스트 보내기')}</span></button></>}<button title={t('전체 화면 · Esc로 나가기')} disabled={!ready&&!hasFrame} onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void surface.current?.requestFullscreen().catch(()=>setProblem('전체 화면 전환을 사용할 수 없습니다.'));}}><Maximize size={18}/></button><button title={t('원격 연결 설정')} aria-label={t('원격 연결 설정')} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={openSettings}><Settings2 size={18}/><span>{t('설정')}</span></button><button className="disconnect" onClick={()=>end()}><Power size={16}/><span>{t('연결 종료')}</span></button></div></header>
  {qualitySupported===false&&<div className="remote-quality-note">{t('화질을 선택하려면 맥북에 최신 MacLink 메뉴바 앱을 설치하고 연결을 다시 시작하세요.')} <a href={CONNECTOR_DOWNLOAD_URL} download>{t('앱 받기')}</a> · <a href={CONNECTOR_RELEASES_URL} target="_blank" rel="noreferrer">{t('릴리스')}</a></div>}
  {!soundEnabled&&<div className="audio-note" role="status">{t(hostAudioEnabled===false?'호스트 오디오 중단 요청이 적용되었습니다.':'브라우저 소리는 꺼졌습니다. 호스트 오디오 중단은 지원되는 연결 프로그램에서 확인됩니다.')}</div>}
  {pcmNote&&<div className="audio-note" role="status">{t(pcmNote)}</div>}
  {audioBlocked&&hasAudio&&<div className="audio-note" role="status">{t('브라우저에서 소리 자동 재생을 차단했습니다. 소리 켜기를 눌러 주세요.')}<button onClick={toggleAudio}>{t('소리 켜기')}</button></div>}
  {!hasAudio&&audioSupported===false&&<div className="audio-note" role="status">{t('시스템 소리를 들으려면 Mac에 최신 연결 프로그램을 설치하고 다시 연결하세요.')}</div>}
  {!hasAudio&&audioSupported===true&&audioError&&<div className="audio-note" role="status">{t('시스템 소리를 사용할 수 없습니다. MacLink 권한과 설정을 확인하세요.')}</div>}
  {qualityError&&<div className="remote-alert" role="alert">{t(qualityError)}</div>}
  {(!hasFrame||ready)&&(problem||(networkNote&&!ready))&&<div className="remote-alert" role="alert">{t(problem||networkNote)}</div>}
  <div ref={surface} className={'remote-surface '+(inputOn?'input-active':'')} tabIndex={0} aria-label={t('원격 맥북 화면. 클릭하면 입력이 시작됩니다. Shift Escape로 입력을 해제합니다.')} onPointerDown={e=>pointer(e,'down')} onPointerMove={e=>pointer(e,'move')} onPointerUp={e=>pointer(e,'up')} onPointerCancel={()=>send({type:'release'})} onLostPointerCapture={()=>send({type:'release'})} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>key(e,true)} onKeyUp={e=>key(e,false)} onBlur={()=>{send({type:'release'});focused.current=false;setInputOn(false);}} onWheel={e=>{if(inputOn&&live.current&&!inputBlocked.current&&!settingsOpen){e.preventDefault();for(const event of keyboard.current.modifiers(e,mapping.current))send(event);send({type:'wheel',dx:Math.max(-2000,Math.min(2000,e.deltaX)),dy:Math.max(-2000,Math.min(2000,e.deltaY))});}}}>
   <video ref={video} autoPlay playsInline muted onWaiting={holdScreen} onStalled={holdScreen} onLoadedMetadata={updateDimensions} onResize={updateDimensions}/><canvas ref={held} className="remote-held-frame" aria-hidden="true"/>
   {!ready&&!hasFrame&&<div className="remote-wait"><div className="waiting-orbit"><Monitor size={40} strokeWidth={1.3}/><LoaderCircle size={22} className="spin"/></div><h2>{t(status)}</h2><p>{t('맥북의 연결 프로그램이 실행 중이어야 합니다.')}<br/>{t(ice.current?.turnEnabled?'직접 연결과 TURN 중계 경로를 확인하고 있습니다.':'TURN 미설정 · 직접 연결을 시도합니다.')}</p><button className="button button-white" onClick={()=>end()}>{t('연결 취소')}</button></div>}
  </div><audio ref={audio} className="remote-audio" aria-hidden="true"/><footer className="remote-footer"><span>{s.mode==='view'?<Eye size={15}/>:<MousePointer2 size={15}/>} {t(hasFrame&&!ready?'마지막 화면을 유지하며 다시 연결하고 있습니다.':checking?'연결 상태 확인 중':s.mode==='view'?'보기 전용':inputOn?'키보드·마우스 입력 중 · Shift + Esc로 해제':'화면을 클릭하면 키보드·마우스 입력 시작')}</span>{active.current&&ice.current?.tls443&&<button onClick={()=>{tlsTried.current=true;void reconnect(generation.current,'tls');}}>{t('TURN/TLS 443으로 다시 연결')}</button>}<span><ShieldCheck size={14}/>{t('내 계정 연결')}</span></footer>
  <RemoteSettings open={settingsOpen} onOpenChange={setSettingsOpen} mapping={keyboardMapping} onMappingChange={changeKeyboardMapping} saved={keyboardSaved} viewOnly={s.mode!=='control'} onDiagnostics={connectionReport}/>
  {textOpen&&<div className="text-send"><div><strong>{t('맥북에 텍스트 보내기')}</strong><button onClick={()=>setTextOpen(false)} aria-label={t('닫기')}><X size={16}/></button></div><p>{t('현재 맥북에서 선택된 입력 칸에 텍스트를 입력합니다.')}</p><textarea value={text} onChange={e=>setText(e.target.value)} maxLength={2000} placeholder={t('한글 문장이나 긴 텍스트를 입력하세요')}/><button className="button button-green" disabled={!text||!ready||checking} onClick={()=>{send({type:'text',text});setText('');setTextOpen(false);}}><Send size={15}/>{t('보내기')}</button></div>}
 </div>;
}
