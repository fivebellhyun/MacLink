import {test} from 'node:test';
import assert from 'node:assert/strict';
import {peerConfiguration,describeRoute,makeOffer,rememberConnection} from '../lib/remote-client.ts';
const ice={iceServers:[{urls:['stun:stun.cloudflare.com:3478']},{urls:['turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:3478?transport=tcp','turns:turn.cloudflare.com:443?transport=tcp'],username:'temporary-user',credential:'temporary-password'}],turnEnabled:true,tls443:true,expiresAt:Date.now()+86400000};
test('TLS-only mode excludes direct and UDP candidates and uses relay ICE policy',()=>{
 const config=peerConfiguration(ice,'tls');assert.equal(config.iceTransportPolicy,'relay');assert.deepEqual(config.iceServers,[{urls:['turns:turn.cloudflare.com:443?transport=tcp'],username:'temporary-user',credential:'temporary-password'}]);
 const auto=peerConfiguration(ice,'auto');assert.equal(auto.iceTransportPolicy,'all');assert.equal(auto.iceServers.length,2);
 assert.throws(()=>peerConfiguration({...ice,turnEnabled:false},'tls'),/TURN/);
});
test('route label follows the selected candidate pair, including relay transport, without guessing a remote protocol',async()=>{
 for(const [local,remote,expected] of [
  [{candidateType:'srflx'},{candidateType:'srflx'},'WebRTC 직접 연결'],
  [{candidateType:'relay',relayProtocol:'tls'},{candidateType:'host'},'WebRTC · TURN/TLS'],
  [{candidateType:'relay',relayProtocol:'tcp'},{candidateType:'srflx'},'WebRTC · TURN/TCP'],
  [{candidateType:'relay',url:'turns:turn.cloudflare.com:443?transport=tcp'},{candidateType:'host'},'WebRTC · TURN/TLS'],
  [{candidateType:'host'},{candidateType:'relay'},'WebRTC · TURN 중계'],
 ]){
  const stats=new Map([['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote'}],['local',local],['remote',remote]]);
  assert.equal(await describeRoute({getStats:async()=>stats}),expected);
 }
 assert.equal(await describeRoute({getStats:async()=>new Map()}),'WebRTC · 경로 확인 중');
});
test('late ICE relay candidates are included after the previous six-second cutoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 class Peer extends EventTarget{connectionState='new';iceGatheringState='gathering';localDescription=null;async createOffer(){return {sdp:'v=0'};}async setLocalDescription(s){this.localDescription=s;}}
 const peer=new Peer();let settled=false;
 const promise=makeOffer(peer).then(sdp=>{settled=true;return sdp;});await Promise.resolve();await Promise.resolve();
 t.mock.timers.tick(7000);await Promise.resolve();assert.equal(settled,false);
 peer.localDescription={sdp:'v=0\r\na=candidate:late typ relay'};peer.iceGatheringState='complete';peer.dispatchEvent(new Event('icegatheringstatechange'));
 assert.match(await promise,/late typ relay/);
});
test('tab recovery persists the connection preference without caching TURN credentials',t=>{
 let stored='';Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{setItem(_k,v){stored=v;}}});t.after(()=>delete globalThis.sessionStorage);
 rememberConnection({id:'a'.repeat(24),token:'b'.repeat(64),name:'Mac',mode:'control',status:'active',generation:1,connectionMode:'tls',iceConfig:ice});
 const value=JSON.parse(stored);assert.equal(value.connectionMode,'tls');assert.equal(stored.includes('temporary-password'),false);assert.equal(Object.hasOwn(value,'iceConfig'),false);
});
