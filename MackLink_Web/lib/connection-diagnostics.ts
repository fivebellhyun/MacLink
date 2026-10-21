// Connection diagnostics deliberately retain only connection states and counters.
// Never add URLs, ICE candidate text, SDP, credentials, screen data, or input here.
export const DIAGNOSTIC_EVENTS = [
 'status-ok','status-error','peer-state','ice-state','data-channel','reconnect',
 'transport','video-held','video-live','network','session-end',
] as const;
export const DIAGNOSTIC_REASONS = [
 'transient-status','authorization-ended','status-expired','peer-disconnected',
 'peer-failed','channel-closed','ice-timeout','network-offline','network-online',
 'retry','resume','track-muted','track-ended','video-stalled',
 'viewer-closed','unknown',
] as const;
export type DiagnosticEvent = typeof DIAGNOSTIC_EVENTS[number];
export type DiagnosticReason = typeof DIAGNOSTIC_REASONS[number];
export type DiagnosticFields = {generation?:number;httpStatus?:number;state?:string;reason?:DiagnosticReason};
type DiagnosticEntry = {atMs:number;event:DiagnosticEvent;generation?:number;httpStatus?:number;state?:string;reason?:DiagnosticReason};
export type ConnectionReportContext = {
 mode:'auto'|'tls';generation:number;connectorVersion?:string|null;
 lastStatusAgeMs:number|null;dataChannelState?:RTCDataChannelState|null;
};
const STATES = new Set([
 'new','connecting','connected','disconnected','failed','closed','checking',
 'completed','gathering','complete','open','closing','online','offline',
 'webrtc','stalled','live','held','ended',
]);
const EVENTS = new Set<string>(DIAGNOSTIC_EVENTS);
const REASONS = new Set<string>(DIAGNOSTIC_REASONS);
const oneOf = (value:unknown,allowed:readonly string[]) => typeof value==='string'&&allowed.includes(value)?value:null;
const number = (value:unknown,max=Number.MAX_SAFE_INTEGER) => typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:null;
const integer = (value:unknown,max:number) => typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=max?value:null;
const clock = () => typeof performance==='undefined'?Date.now():performance.now();

export class ConnectionDiagnostics {
 private readonly entries:DiagnosticEntry[]=[];
 private readonly origin:number;
 private readonly now:()=>number;
 private lastMs=0;
 constructor(now:()=>number=clock){this.now=now;this.origin=number(now())??0;}
 record(event:DiagnosticEvent,fields:DiagnosticFields={}){
  // Runtime allowlists also protect reports from callers without TypeScript.
  if(!EVENTS.has(event))return;
  const elapsed=number(this.now()-this.origin);
  this.lastMs=Math.max(this.lastMs,elapsed===null?this.lastMs:Math.round(elapsed));
  const entry:DiagnosticEntry={atMs:this.lastMs,event};
  const generation=integer(fields.generation,1_000_000_000);
  if(generation!==null)entry.generation=generation;
  const status=integer(fields.httpStatus,599);
  if(status!==null&&status>=100)entry.httpStatus=status;
  if(typeof fields.state==='string'&&STATES.has(fields.state))entry.state=fields.state;
  if(typeof fields.reason==='string'&&REASONS.has(fields.reason))entry.reason=fields.reason;
  this.entries.push(entry);
  if(this.entries.length>50)this.entries.shift();
 }
 snapshot():DiagnosticEntry[]{return this.entries.map(entry=>({...entry}));}
}

type StatsSource = Pick<RTCPeerConnection,'getStats'|'connectionState'|'iceConnectionState'|'iceGatheringState'>;
type StatsEntry = Record<string,unknown>;
function candidateDetails(candidate:StatsEntry|undefined){
 if(!candidate)return null;
 return {
  candidateType:oneOf(candidate.candidateType,['host','srflx','prflx','relay']),
  protocol:oneOf(candidate.protocol,['udp','tcp']),
  relayProtocol:oneOf(candidate.relayProtocol,['udp','tcp','tls']),
 };
}
async function selectedPair(peer:StatsSource){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const stats=await Promise.race([
   peer.getStats(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),1500);}),
  ]);
  const entries:StatsEntry[]=[];
  stats.forEach(value=>{if(value&&typeof value==='object')entries.push(value as StatsEntry);});
  const transport=entries.find(item=>item.type==='transport'&&typeof item.selectedCandidatePairId==='string');
  const pair=transport
   ?entries.find(item=>item.type==='candidate-pair'&&item.id===transport.selectedCandidatePairId)
   :entries.find(item=>item.type==='candidate-pair'&&item.selected===true)
    ??entries.find(item=>item.type==='candidate-pair'&&item.nominated===true&&item.state==='succeeded');
  if(!pair)return {status:'no-selected-pair' as const};
  const local=entries.find(item=>item.type==='local-candidate'&&item.id===pair.localCandidateId);
  const remote=entries.find(item=>item.type==='remote-candidate'&&item.id===pair.remoteCandidateId);
  return {
   status:'available' as const,
   state:oneOf(pair.state,['frozen','waiting','in-progress','failed','succeeded']),
   currentRoundTripTimeMs:number(pair.currentRoundTripTime)===null?null:Math.round((pair.currentRoundTripTime as number)*1000),
   availableOutgoingBitrateBps:number(pair.availableOutgoingBitrate),
   availableIncomingBitrateBps:number(pair.availableIncomingBitrate),
   bytesSent:number(pair.bytesSent),bytesReceived:number(pair.bytesReceived),
   local:candidateDetails(local),remote:candidateDetails(remote),
  };
 }catch{
  // Browser errors can contain addresses or candidate text. Keep no error text.
  return {status:'unavailable' as const};
 }finally{if(timer!==undefined)clearTimeout(timer);}
}

export async function buildConnectionReport(trace:ConnectionDiagnostics,peer:StatsSource|null|undefined,context:ConnectionReportContext):Promise<string>{
 const version=typeof context.connectorVersion==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(context.connectorVersion)?context.connectorVersion:null;
 const report={
  format:'MacLink connection diagnostics',version:1,viewerVersion:'1.4.0',generatedAt:new Date().toISOString(),
  connection:{
   mode:oneOf(context.mode,['auto','tls']),
   generation:integer(context.generation,1_000_000_000),connectorVersion:version,
   lastStatusAgeMs:number(context.lastStatusAgeMs)===null?null:Math.round(context.lastStatusAgeMs as number),
   peerState:oneOf(peer?.connectionState,['new','connecting','connected','disconnected','failed','closed']),
   iceState:oneOf(peer?.iceConnectionState,['new','checking','connected','completed','disconnected','failed','closed']),
   iceGatheringState:oneOf(peer?.iceGatheringState,['new','gathering','complete']),
   dataChannelState:oneOf(context.dataChannelState,['connecting','open','closing','closed']),
  },
  selectedCandidatePair:peer?await selectedPair(peer):{status:'no-peer'},
  events:trace.snapshot(),
 };
 return JSON.stringify(report,null,2);
}
