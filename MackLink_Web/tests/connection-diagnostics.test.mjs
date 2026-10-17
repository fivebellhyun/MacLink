import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionDiagnostics,buildConnectionReport} from '../lib/connection-diagnostics.ts';

const context={mode:'tls',generation:2,connectorVersion:'1.2.3',lastStatusAgeMs:700,dataChannelState:'open'};
const peerFor=(entries,overrides={})=>({connectionState:'connected',iceConnectionState:'completed',iceGatheringState:'complete',getStats:async()=>new Map(entries.map((item,i)=>[i,item])),...overrides});

test('diagnostics retain only the last 50 safe events with monotonic relative times',()=>{
 let now=500;const trace=new ConnectionDiagnostics(()=>now);
 for(let index=0;index<60;index++){now+=10;trace.record('peer-state',{generation:index,state:'connected',reason:'retry',httpStatus:200});}
 now=1;trace.record('network',{state:'offline',reason:'network-offline'});
 const events=trace.snapshot();
 assert.equal(events.length,50);assert.equal(events[0].generation,11);
 assert.equal(events.at(-1).atMs,600);assert.equal(events.at(-2).atMs,600);
 assert.equal(events.at(-1).event,'network');
 events[0].state='private mutation';
 assert.equal(trace.snapshot()[0].state,'connected');
});

test('runtime allowlists reject unknown events, arbitrary reason and state text, and invalid counters',async()=>{
 const secret='secret://invite-token/192.168.1.2';const trace=new ConnectionDiagnostics(()=>0);
 trace.record(secret,{state:secret,reason:secret,generation:2});
 trace.record('status-error',{state:secret,reason:secret,httpStatus:Infinity,generation:-2,url:secret,error:secret});
 const report=await buildConnectionReport(trace,null,{...context,mode:secret,connectorVersion:secret,generation:NaN,lastStatusAgeMs:-2,dataChannelState:secret,sessionId:secret});
 assert.ok(!report.includes(secret));
 const parsed=JSON.parse(report);
 assert.deepEqual(parsed.events,[{atMs:0,event:'status-error'}]);
 assert.equal(parsed.connection.mode,null);assert.equal(parsed.connection.connectorVersion,null);
 assert.equal(parsed.connection.generation,null);assert.equal(parsed.connection.lastStatusAgeMs,null);
 assert.equal(parsed.connection.dataChannelState,null);assert.deepEqual(parsed.selectedCandidatePair,{status:'no-peer'});
});

test('the selected candidate pair exposes aggregate counters and safe route types without addresses, identifiers or raw stats',async()=>{
 const secret='sensitive-access-token';const ip='198.51.100.57';const sdp='v=0 sensitive SDP';
 const entries=[
  {id:'private-transport',type:'transport',selectedCandidatePairId:'private-pair',sdp,url:secret},
  {id:'private-pair',type:'candidate-pair',localCandidateId:'private-local',remoteCandidateId:'private-remote',state:'succeeded',currentRoundTripTime:0.027,availableOutgoingBitrate:1200000,availableIncomingBitrate:900000,bytesSent:1000,bytesReceived:40000,address:ip,candidate:secret},
  {id:'private-local',type:'local-candidate',candidateType:'relay',protocol:'tcp',relayProtocol:'tls',address:ip,port:443,url:secret,username:secret,password:secret},
  {id:'private-remote',type:'remote-candidate',candidateType:'srflx',protocol:'udp',address:ip,candidate:sdp},
  {id:'unselected-pair',type:'candidate-pair',selected:true,state:'failed',bytesSent:999999},
 ];
 const trace=new ConnectionDiagnostics(()=>0);trace.record('ice-state',{state:'completed',generation:2});
 const report=await buildConnectionReport(trace,peerFor(entries),context),parsed=JSON.parse(report);
 for(const forbidden of [secret,ip,sdp,'private-pair','private-local','private-remote','username','password','candidateId','address','port'])assert.equal(report.includes(forbidden),false,forbidden);
 assert.deepEqual(parsed.selectedCandidatePair,{
  status:'available',state:'succeeded',currentRoundTripTimeMs:27,availableOutgoingBitrateBps:1200000,
  availableIncomingBitrateBps:900000,bytesSent:1000,bytesReceived:40000,
  local:{candidateType:'relay',protocol:'tcp',relayProtocol:'tls'},
  remote:{candidateType:'srflx',protocol:'udp',relayProtocol:null},
 });
 assert.equal(parsed.connection.peerState,'connected');assert.equal(parsed.connection.iceState,'completed');
 assert.equal(parsed.viewerVersion,'1.3.2');assert.match(parsed.generatedAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('candidate types and protocol fields are also filtered at runtime and never copied as free text',async()=>{
 const secret='turns://private.example:443?token=secret';
 const entries=[
  {id:'pair',type:'candidate-pair',selected:true,state:secret,localCandidateId:'local',remoteCandidateId:'remote',bytesSent:NaN,bytesReceived:-5,currentRoundTripTime:Infinity,availableOutgoingBitrate:secret},
  {id:'local',type:'local-candidate',candidateType:secret,protocol:secret,relayProtocol:secret},
  {id:'remote',type:'remote-candidate',candidateType:'host',protocol:'udp'},
 ];
 const report=await buildConnectionReport(new ConnectionDiagnostics(),peerFor(entries,{connectionState:secret,iceConnectionState:secret}),context),parsed=JSON.parse(report);
 assert.equal(report.includes(secret),false);
 assert.equal(parsed.connection.peerState,null);assert.equal(parsed.connection.iceState,null);
 assert.equal(parsed.selectedCandidatePair.state,null);assert.equal(parsed.selectedCandidatePair.bytesReceived,null);
 assert.equal(parsed.selectedCandidatePair.currentRoundTripTimeMs,null);
 assert.deepEqual(parsed.selectedCandidatePair.local,{candidateType:null,protocol:null,relayProtocol:null});
});

test('a stats rejection yields a usable state and trace report without exposing the browser error',async()=>{
 const secret='203.0.113.91 authorization=secret';const trace=new ConnectionDiagnostics(()=>0);
 trace.record('status-error',{httpStatus:503,reason:'transient-status',generation:3});
 const report=await buildConnectionReport(trace,peerFor([],{getStats:async()=>{throw new Error(secret);}}),context),parsed=JSON.parse(report);
 assert.equal(report.includes(secret),false);assert.deepEqual(parsed.selectedCandidatePair,{status:'unavailable'});
 assert.equal(parsed.events[0].httpStatus,503);assert.equal(parsed.connection.peerState,'connected');
});

test('unselected connectivity checks are not represented as the active route',async()=>{
 const peer=peerFor([{id:'pair',type:'candidate-pair',state:'in-progress',bytesSent:1000}]);
 const parsed=JSON.parse(await buildConnectionReport(new ConnectionDiagnostics(),peer,context));
 assert.deepEqual(parsed.selectedCandidatePair,{status:'no-selected-pair'});
});

test('an older browser can identify its nominated successful pair without exposing its IDs',async()=>{
 const peer=peerFor([{id:'hidden',type:'candidate-pair',state:'succeeded',nominated:true,bytesSent:24}]);
 const report=await buildConnectionReport(new ConnectionDiagnostics(),peer,context),parsed=JSON.parse(report);
 assert.equal(parsed.selectedCandidatePair.bytesSent,24);assert.equal(report.includes('hidden'),false);
});

test('a browser that never resolves its stats cannot leave diagnostics waiting indefinitely',async t=>{
 let scheduled,cleared;
 t.mock.method(globalThis,'setTimeout',(callback,delay)=>{scheduled={callback,delay};return 123;});
 t.mock.method(globalThis,'clearTimeout',id=>{cleared=id;});
 const report=buildConnectionReport(new ConnectionDiagnostics(),peerFor([],{getStats:()=>new Promise(()=>{})}),context);
 assert.equal(scheduled.delay,1500);scheduled.callback();
 assert.equal(JSON.parse(await report).selectedCandidatePair.status,'unavailable');
 assert.equal(cleared,123);
});
