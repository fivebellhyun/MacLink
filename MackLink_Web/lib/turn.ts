// This module is server-only. Long-lived TURN keys never leave the Worker.
export type IceServer = {urls:string[];username?:string;credential?:string};
export type IceConfig = {iceServers:IceServer[];turnEnabled:boolean;tls443:boolean;expiresAt:number|null;warning?:string};
export type TurnBindings = {DB?:D1Database;TURN_CONFIG_KEY?:string};
type Settings = {owner:string;sealed:string;updated:number};
type TurnKey = {keyId:string;apiToken:string};
export class TurnError extends Error {
  status:number;
  constructor(status:number,message:string){super(message);this.status=status;}
}
const STUN:IceServer={urls:['stun:stun.cloudflare.com:3478']};
const TTL=86400;
const pending=new Map<string,Promise<IceConfig>>();
export const directIce=(warning?:string):IceConfig=>({iceServers:[STUN],turnEnabled:false,tls443:false,expiresAt:null,...(warning?{warning}:{})});

async function encryptionKey(env:TurnBindings){
  if(!/^[a-f0-9]{64}$/.test(env.TURN_CONFIG_KEY||''))throw new TurnError(503,'중계 설정 저장소가 준비되지 않았습니다. 사이트 관리자에게 문의하세요.');
  const bytes=Uint8Array.from(env.TURN_CONFIG_KEY!.match(/../g)!,v=>parseInt(v,16));
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
async function seal(env:TurnBindings,value:unknown,context:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},await encryptionKey(env),new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({iv:Array.from(iv),data:Array.from(new Uint8Array(data))});
}
async function unseal<T>(env:TurnBindings,value:string,context:string):Promise<T>{
  const {iv,data}=JSON.parse(value);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:new TextEncoder().encode(context)},await encryptionKey(env),new Uint8Array(data));
  return JSON.parse(new TextDecoder().decode(plain));
}
function validKey(value:unknown):TurnKey{
  const v=value as TurnKey;
  if(!v||typeof v.keyId!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(v.keyId)||typeof v.apiToken!=='string'||!/^[\x21-\x7e]{20,512}$/.test(v.apiToken))throw new TurnError(400,'TURN Key ID와 해당 키의 API Token을 확인해 주세요.');
  return {keyId:v.keyId,apiToken:v.apiToken};
}
export async function issueCloudflareIce(key:TurnKey):Promise<IceConfig>{
  let response:Response;
  try{
    response=await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/'+encodeURIComponent(key.keyId)+'/credentials/generate-ice-servers',{
      // The deployed workerd runtime supports manual/follow, but rejects "error".
      // Never follow redirects with the provider's long-lived Authorization token.
      method:'POST',headers:{Authorization:'Bearer '+key.apiToken,'Content-Type':'application/json'},body:JSON.stringify({ttl:TTL}),signal:AbortSignal.timeout(7000),redirect:'manual',
    });
  }catch{throw new TurnError(502,'TURN 자격 증명 발급 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');}
  if(response.status>=300&&response.status<400)throw new TurnError(502,'TURN 발급 서버에서 예상하지 못한 주소 이동 응답을 받았습니다. 잠시 후 다시 시도하세요.');
  if(!response.ok)throw new TurnError(response.status===401||response.status===403?400:502,response.status===401||response.status===403?'Cloudflare TURN 키 인증에 실패했습니다. Key ID와 해당 키의 API Token을 확인하세요.':'TURN 자격 증명을 발급하지 못했습니다. Cloudflare 설정과 서비스 상태를 확인하세요.');
  let data:any;
  try{data=await response.json();}catch{throw new TurnError(502,'TURN 서버의 응답을 확인하지 못했습니다.');}
  const iceServers:IceServer[]=[STUN];
  for(const server of Array.isArray(data.iceServers)?data.iceServers:[]){
    if(typeof server.username!=='string'||!server.username||server.username.length>2048||typeof server.credential!=='string'||!server.credential||server.credential.length>2048)continue;
    // Keep only the provider's documented endpoints; exclude browser-blocked port 53.
    const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter((u:unknown):u is string=>typeof u==='string'&&/^(turn:turn\.cloudflare\.com:(3478|443)\?transport=udp|turn:turn\.cloudflare\.com:(3478|80)\?transport=tcp|turns:turn\.cloudflare\.com:(5349|443)\?transport=tcp)$/.test(u));
    if(urls.length)iceServers.push({urls,username:server.username,credential:server.credential});
  }
  if(!iceServers.some(s=>s.urls.includes('turns:turn.cloudflare.com:443?transport=tcp')))throw new TurnError(502,'TURN 응답에 TLS 443 경로가 없습니다. 키와 서비스 설정을 확인하세요.');
  return {iceServers,turnEnabled:true,tls443:true,expiresAt:Date.now()+TTL*1000};
}
export async function turnStatus(env:TurnBindings,owner:string){
  const row=await env.DB!.prepare('SELECT updated FROM turn_settings WHERE owner=?').bind(owner).first<{updated:number}>();
  return {configured:!!row,provider:'cloudflare',tls443:!!row,updated:row?.updated??null,canConfigure:/^[a-f0-9]{64}$/.test(env.TURN_CONFIG_KEY||'')};
}
export async function saveTurn(env:TurnBindings,owner:string,value:unknown){
  const key=validKey(value),sealed=await seal(env,key,'turn-settings:'+owner);
  // Validate credentials before replacing a working configuration.
  await issueCloudflareIce(key);
  const updated=Date.now();
  await env.DB!.batch([
    env.DB!.prepare('INSERT INTO turn_settings (owner,sealed,updated) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET sealed=excluded.sealed,updated=excluded.updated').bind(owner,sealed,updated),
    env.DB!.prepare('DELETE FROM turn_credentials WHERE owner=?').bind(owner),
  ]);
  return {configured:true,provider:'cloudflare',tls443:true,updated,canConfigure:true};
}
export async function removeTurn(env:TurnBindings,owner:string){
  await env.DB!.batch([env.DB!.prepare('DELETE FROM turn_settings WHERE owner=?').bind(owner),env.DB!.prepare('DELETE FROM turn_credentials WHERE owner=?').bind(owner)]);
}
async function loadIce(env:TurnBindings,owner:string,subject:string):Promise<IceConfig>{
  const settings=await env.DB!.prepare('SELECT * FROM turn_settings WHERE owner=?').bind(owner).first<Settings>();
  if(!settings)return directIce('맥 소유자가 TURN을 등록하면 제한된 네트워크에서 TLS 443 중계를 사용할 수 있습니다.');
  try{
    const cache=await env.DB!.prepare('SELECT sealed,expires FROM turn_credentials WHERE subject=? AND owner=? AND expires>?').bind(subject,owner,Date.now()+600000).first<{sealed:string;expires:number}>();
    if(cache)return await unseal<IceConfig>(env,cache.sealed,'turn-ice:'+owner+':'+subject);
    const key=await unseal<TurnKey>(env,settings.sealed,'turn-settings:'+owner);
    const ice=await issueCloudflareIce(key),sealed=await seal(env,ice,'turn-ice:'+owner+':'+subject);
    await env.DB!.prepare('DELETE FROM turn_credentials WHERE expires<?').bind(Date.now()).run();
    await env.DB!.prepare('INSERT INTO turn_credentials (subject,owner,sealed,expires) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM turn_settings WHERE owner=? AND updated=?) ON CONFLICT(subject) DO UPDATE SET sealed=excluded.sealed,expires=excluded.expires').bind(subject,owner,sealed,ice.expiresAt,owner,settings.updated).run();
    return ice;
  }catch{
    return directIce('TURN 자격 증명을 발급하지 못했습니다. 맥 소유자가 연결 설정에서 TURN 키를 확인해 주세요.');
  }
}
export async function connectionIce(env:TurnBindings,owner:string,subject:string):Promise<IceConfig>{
  const cacheKey=owner+':'+subject;
  if(pending.has(cacheKey))return pending.get(cacheKey)!;
  const promise=loadIce(env,owner,subject);pending.set(cacheKey,promise);
  try{return await promise;}finally{pending.delete(cacheKey);}
}
