import type {IceConfig} from './turn';
export type {IceConfig} from './turn';
export type ConnectionMode='auto'|'tls';
export type StoredConnection={id:string;token:string;name:string;mode:string;status:string;generation:number;inviteId?:string;connectionMode?:ConnectionMode};
const KEY='maclink.current-connection';
export function rememberConnection(s:StoredConnection){try{sessionStorage.setItem(KEY,JSON.stringify({id:s.id,token:s.token,name:s.name,mode:s.mode,status:s.status,generation:s.generation,inviteId:s.inviteId,connectionMode:s.connectionMode==='tls'?'tls':'auto'}));}catch{}}
export function forgetConnection(){try{sessionStorage.removeItem(KEY);}catch{}}
export function restoreConnection():StoredConnection|null{try{const s=JSON.parse(sessionStorage.getItem(KEY)||'null');return s&&/^[a-f0-9]{24}$/.test(s.id)&&/^[a-f0-9]{64}$/.test(s.token)&&['view','control'].includes(s.mode)?s:null;}catch{return null;}}
export function tlsIceServers(config:IceConfig):RTCIceServer[]{return config.iceServers.map(s=>({...s,urls:s.urls.filter(u=>/^turns:[^/?]+:443\?transport=tcp$/.test(u))})).filter(s=>s.urls.length>0);}
export function peerConfiguration(config:IceConfig,mode:ConnectionMode='auto'):RTCConfiguration{
 const iceServers=mode==='tls'?tlsIceServers(config):config.iceServers;
 if(mode==='tls'&&(!config.turnEnabled||!iceServers.length))throw new Error(config.warning||'맥 소유자가 연결 설정에서 TURN 키를 먼저 등록해야 합니다.');
 return {iceServers,iceTransportPolicy:mode==='tls'?'relay':'all',bundlePolicy:'max-bundle'};
}
export function createPeer(config:IceConfig,mode:ConnectionMode='auto'){const peer=new RTCPeerConnection(peerConfiguration(config,mode));peer.addTransceiver('video',{direction:'recvonly'});const channel=peer.createDataChannel('control',{ordered:true});return{peer,channel};}
export async function makeOffer(peer:RTCPeerConnection){
 await peer.setLocalDescription(await peer.createOffer());
 await new Promise<void>((resolve,reject)=>{
  if(peer.iceGatheringState==='complete')return resolve();
  const done=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',on);peer.removeEventListener('connectionstatechange',on);peer.connectionState==='closed'?reject(new Error('연결 준비가 취소되었습니다.')):resolve();};
  const on=()=>{if(peer.iceGatheringState==='complete'||peer.connectionState==='closed')done();};
  const timer=setTimeout(done,20000);
  peer.addEventListener('icegatheringstatechange',on);peer.addEventListener('connectionstatechange',on);
 });
 if(peer.connectionState==='closed'||!peer.localDescription)throw new Error('연결 준비가 취소되었습니다.');
 return peer.localDescription.sdp;
}
export async function describeRoute(peer:RTCPeerConnection):Promise<string>{
 const stats=await peer.getStats();let pair:any;
 stats.forEach((s:any)=>{if(s.type==='transport'&&s.selectedCandidatePairId)pair=stats.get(s.selectedCandidatePairId);});
 if(!pair)stats.forEach((s:any)=>{if(s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated)pair=s;});
 if(!pair)return 'WebRTC · 경로 확인 중';
 const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);
 if(local?.candidateType==='relay')return local.relayProtocol==='tls'||local.url?.startsWith('turns:')?'WebRTC · TURN/TLS':local.relayProtocol==='tcp'?'WebRTC · TURN/TCP':'WebRTC · TURN 중계';
 return remote?.candidateType==='relay'?'WebRTC · TURN 중계':'WebRTC 직접 연결';
}
export async function probeTls443(config:IceConfig):Promise<void>{
 const peer=new RTCPeerConnection(peerConfiguration(config,'tls'));
 try{
  await new Promise<void>((resolve,reject)=>{
   let error='TLS 443 중계 후보를 확보하지 못했습니다. 이 네트워크의 방화벽·프록시 정책을 확인하세요.';
   const finish=(ok:boolean)=>{clearTimeout(timer);peer.onicecandidate=null;peer.onicecandidateerror=null;peer.onicegatheringstatechange=null;ok?resolve():reject(new Error(error));};
   const timer=setTimeout(()=>finish(false),18000);
   peer.onicecandidate=e=>{if(e.candidate?.type==='relay')finish(true);};
   peer.onicecandidateerror=e=>{error='TURN/TLS 443 후보 수집 오류 '+e.errorCode+'. 네트워크 정책 또는 TURN 키 상태를 확인하세요.';};
   peer.onicegatheringstatechange=()=>{if(peer.iceGatheringState==='complete')finish(false);};
   peer.createDataChannel('tls-probe');
   void peer.createOffer().then(offer=>peer.setLocalDescription(offer)).catch(()=>finish(false));
  });
 }finally{peer.close();}
}
