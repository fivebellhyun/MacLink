import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {handleApi,hash} from '../lib/server.ts';
import {handleGoogleAuth} from '../lib/google-auth.ts';
function harness(){
 const sqlite=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 function prepare(q){let args=[];return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(q).get(...args)||null;},async all(){return {results:sqlite.prepare(q).all(...args)};},async run(){const r=sqlite.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}};}};}
 let batchQueue=Promise.resolve();const browserCookies=new Map();
 const env={AUTH_BASE_URL:'https://maclink.example',DB:{prepare,async batch(stmts){const result=batchQueue.then(async()=>{sqlite.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}});batchQueue=result.catch(()=>{});return result;}}};
 async function signedCookie(owner,email=owner+'@example.com'){
  const id='google:'+owner,token=randomBytes(32).toString('base64url'),now=Date.now();
  sqlite.prepare('INSERT INTO auth_users (id,google_sub,email,name,created,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email').run(id,owner,email,null,now,now);
  sqlite.prepare('INSERT INTO auth_sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,now,now+3600000);
  return '__Host-maclink_session='+token;
 }
 async function cookieFor(owner,email=owner+'@example.com'){
  if(!browserCookies.has(owner))browserCookies.set(owner,await signedCookie(owner,email));
  else sqlite.prepare('UPDATE auth_users SET email=? WHERE id=?').run(email,'google:'+owner);
  return browserCookies.get(owner);
 }
 async function call(path,{method='GET',data,owner=path.startsWith('sessions/')?'owner-a':undefined,email=owner?owner+'@example.com':undefined,token,headers={}}={}){
  const h={...(owner&&method!=='GET'?{Origin:'https://maclink.example'}:{}),...headers};
  if(owner&&email&&!h.Cookie)h.Cookie=await cookieFor(owner,email);
  if(token)h.Authorization='Bearer '+token;
  let body;if(data!==undefined){body=JSON.stringify(data);h['Content-Type']='application/json';}
  return handleApi(new Request('https://maclink.example/api/'+path,{method,headers:h,body}),env);
 }
 async function logout(cookie){return handleGoogleAuth(new Request('https://maclink.example/auth/signout',{method:'POST',headers:{Origin:'https://maclink.example',Cookie:cookie}}),env);}
 return {call,signedCookie,cookieFor,logout,sqlite,env};
}
async function register(h,name='Mac'){const r=await h.call('devices',{method:'POST',owner:'owner-a',data:{name}});assert.equal(r.status,201);return r.json();}
async function online(h,d){const r=await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{screen:true,accessibility:true}}});assert.equal(r.status,200);}
async function connect(h,d,mode='control',options={}){const r=await h.call('devices/'+d.id+'/connect',{method:'POST',owner:'owner-a',data:{mode,offer:'v=0\r\n'},...options});assert.equal(r.status,201,await r.clone().text());return r.json();}
async function active(h,d,s){const r=await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0\r\n'}});assert.equal(r.status,200);}

const turnToken='fake-turn-api-token-for-tests-only';
const turnKeyId='test_turn_key_1234';
function turnProvider(t,{status=201,missingTls=false}={}){
 let calls=0;const requests=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  requests.push({url:String(url),init});calls++;
  if(status!==201)return Response.json({secret:turnToken},{status});
  return Response.json({iceServers:[{urls:['stun:stun.cloudflare.com:3478']},{urls:['turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:3478?transport=tcp',...(missingTls?[]:['turns:turn.cloudflare.com:443?transport=tcp']),'turn:turn.cloudflare.com:53?transport=udp','turns:evil.example:443?transport=tcp'],username:'temporary-user-'+calls,credential:'temporary-password-'+calls}]},{status:201});
 });
 return {get calls(){return calls;},requests};
}
async function configureTurn(h,owner='owner-a',token=turnToken){
 h.env.TURN_CONFIG_KEY='a'.repeat(64);
 const response=await h.call('network',{owner,method:'POST',data:{keyId:turnKeyId,apiToken:token}});
 assert.equal(response.status,200,await response.clone().text());return response.json();
}

async function qualityOnline(h,d,report){
 h.sqlite.prepare('UPDATE devices SET seen=0 WHERE id=?').run(d.id);
 return h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{version:'1.2.0',screen:true,accessibility:true,qualityControl:true,...(report?{quality:report}:{})}}});
}

async function legacyDevice(h,d,owner='legacy-owner'){h.sqlite.prepare('UPDATE devices SET owner=? WHERE id=?').run(owner,d.id);}
const claim=(h,d,owner='owner-b',extra={})=>h.call('devices/claim',{method:'POST',owner,data:{device:d.id,token:d.token,confirm:true,...extra}});

test('view-only sessions keep their scope across status and resume',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d,'view');await active(h,d,s);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).mode,'view');assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0,mode:'control'}})).status,200);assert.equal(h.sqlite.prepare('SELECT mode FROM sessions WHERE id=?').get(s.id).mode,'view');});

test('another enrolled Mac cannot answer this session',async()=>{const h=harness(),a=await register(h,'A'),b=await register(h,'B');await online(h,a);const s=await connect(h,a);assert.equal((await h.call('agent/'+b.id+'/answer',{method:'POST',token:b.token,data:{session:s.id,answer:'v=0'}})).status,409);});

test('network leases suspend sessions; registry removal invalidates native key',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'reconnecting');await h.call('devices/'+d.id,{method:'DELETE',owner:'owner-a'});assert.equal((await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).status,401);});

test('cleanup and guest expiry cannot suspend a heartbeat that completed after their stale read',async t=>{
 for(const route of ['cleanup','guest'])await t.test(route,async()=>{
  const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
  let clock=Date.now();t.mock.method(Date,'now',()=>clock);
  h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(clock-19999,s.id);
  const prepare=h.env.DB.prepare;let releaseHeartbeat,heartbeatStarted;
  const started=new Promise(resolve=>{heartbeatStarted=resolve;}),release=new Promise(resolve=>{releaseHeartbeat=resolve;});
  let pendingHeartbeat;
  h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run,all=statement.all;
   statement.run=async()=>{
    if(q.startsWith('UPDATE sessions SET seen=? WHERE id=?')&&!pendingHeartbeat){pendingHeartbeat=true;heartbeatStarted();await release;}
    if(route==='guest'&&q.startsWith("UPDATE sessions SET status='reconnecting'")){releaseHeartbeat();await heartbeat;}
    return run();
   };
   statement.all=async()=>{const rows=await all();if(route==='cleanup'&&q.startsWith("SELECT * FROM sessions WHERE device=? AND status IN ('approved','active') AND seen<")&&rows.results.length){releaseHeartbeat();await heartbeat;}return rows;};
   return statement;
  };
  const heartbeat=h.call('sessions/'+s.id,{token:s.token});await started;clock+=2;
  const response=route==='cleanup'?await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}}):await h.call('sessions/'+s.id,{token:s.token});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(route==='cleanup'?result.session.status:result.status,'active');
  assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'active');
  assert.equal((await heartbeat).status,200);
  t.mock.restoreAll();
 });
});

test('a refreshed Mac heartbeat prevents a stale device snapshot from suspending an active guest',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 h.sqlite.prepare('UPDATE devices SET seen=? WHERE id=?').run(Date.now()-16000,d.id);
 const prepare=h.env.DB.prepare;let race=true;
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{if(race&&q.startsWith("UPDATE sessions SET status='reconnecting'")){race=false;await online(h,d);}return run();};return statement;};
 const response=await h.call('sessions/'+s.id,{token:s.token});assert.equal(response.status,200);assert.equal((await response.json()).status,'active');
});

test('expiry racing with owner revocation returns the ended session without restoring access',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);
 const prepare=h.env.DB.prepare;let race=true;
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{if(race&&q.startsWith("UPDATE sessions SET status='reconnecting'")){race=false;assert.equal((await h.call('devices/'+d.id+'/stop',{method:'POST',owner:'owner-a',data:{}})).status,200);}return run();};return statement;};
 const response=await h.call('sessions/'+s.id,{token:s.token});assert.equal(response.status,200);assert.equal((await response.json()).status,'ended');
 assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0}})).status,403);
});

test('unchanged quality reports avoid repeated row writes and stale reports cannot overwrite a new request',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 const prepare=h.env.DB.prepare,writes=[];
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{const result=await run();if(q.startsWith('UPDATE sessions SET quality_applied='))writes.push(result.meta.changes);return result;};return statement;};
 const report=profile=>h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{qualityControl:true,quality:{session:s.id,generation:0,profile}}}});
 assert.equal((await report('high')).status,200);assert.equal((await report('high')).status,200);assert.deepEqual(writes,[1,0]);
 h.sqlite.prepare("UPDATE sessions SET quality='low',quality_applied=NULL WHERE id=?").run(s.id);
 assert.equal((await report('high')).status,200);assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 assert.equal((await report('low')).status,200);assert.deepEqual(writes,[1,0,0,1]);
});

test('session diagnostics expose only a validated connector version',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 for(const [version,expected] of [['1.2.2','1.2.2'],['1.2.3-beta',null],[d.token,null],[{secret:d.token},null],[null,null]]){
  h.sqlite.prepare('UPDATE devices SET info=? WHERE id=?').run(JSON.stringify({version}),d.id);
  const response=await h.call('sessions/'+s.id,{token:s.token}),result=await response.json();assert.equal(response.status,200);assert.equal(result.connectorVersion,expected);assert.equal(JSON.stringify(result).includes(d.token),false);
 }
});

test('cross-origin owner mutations fail closed',async()=>{const h=harness();assert.equal((await h.call('devices',{method:'POST',owner:'owner-a',headers:{Origin:'https://evil.example'},data:{name:'bad'}})).status,403);});

test('network lease loss stops media/input but resumes approved rights without another consent',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);const poll=await (await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).json();assert.equal(poll.session,null);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'reconnecting');let r=await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0\r\no=new',generation:0}});assert.equal(r.status,200);assert.deepEqual(await r.json(),{generation:1,status:'approved'});assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:0,answer:'v=0 old'}})).status,409);assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:1,answer:'v=0 new'}})).status,200);});

test('a late answer cannot cross a concurrent connection restart',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);
 const prepare=h.env.DB.prepare;let race='answer';
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{
  if(race==='answer'&&q.startsWith('UPDATE sessions SET answer=')){race='';h.sqlite.prepare("UPDATE sessions SET generation=1,offer='v=0 newer',answer=NULL WHERE id=?").run(s.id);}
  return run();};return statement;};
 assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:0,answer:'v=0 old'}})).status,409);
 assert.equal(h.sqlite.prepare('SELECT answer FROM sessions WHERE id=?').get(s.id).answer,null);
 assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:1,answer:'v=0 current'}})).status,200);
 race='input';


});

test('connector diagnostics authenticate without marking an offline Mac online',async()=>{
 const h=harness(),d=await register(h);
 assert.equal((await h.call('agent/'+d.id+'/check')).status,401);
 assert.equal((await h.call('agent/'+d.id+'/check',{token:'f'.repeat(64)})).status,401);
 const before=await (await h.call('agent/'+d.id+'/check',{token:d.token})).json();
 assert.equal(before.online,false);assert.equal(before.seen,0);assert.equal(before.requiredVersion,'1.2.0');
 assert.equal(h.sqlite.prepare('SELECT seen FROM devices WHERE id=?').get(d.id).seen,0);
 const r=await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{version:'1.1.1',screen:true,accessibility:false}}});assert.equal(r.status,200);
 const after=await (await h.call('agent/'+d.id+'/check',{token:d.token})).json();
 assert.equal(after.online,true);assert.equal(after.info.version,'1.1.1');assert.equal(after.info.accessibility,false);
 assert.equal(JSON.stringify(after).includes(d.token),false);
});

test('TURN settings require sign-in and are isolated per owner; secrets are encrypted at rest',async t=>{
 const h=harness(),provider=turnProvider(t);
 assert.equal((await h.call('network')).status,401);
 assert.equal((await h.call('network/ice')).status,401);
 assert.equal((await h.call('network',{method:'POST',owner:'owner-a',headers:{Origin:'https://evil.example'},data:{keyId:turnKeyId,apiToken:turnToken}})).status,403);
 await configureTurn(h);
 assert.equal(provider.calls,1);
 const saved=h.sqlite.prepare('SELECT * FROM turn_settings').get();assert.equal(saved.owner,'google:owner-a');assert.equal(saved.sealed.includes(turnToken),false);assert.equal(saved.sealed.includes(turnKeyId),false);
 const own=await (await h.call('network',{owner:'owner-a'})).json();assert.equal(own.configured,true);assert.equal(JSON.stringify(own).includes(turnToken),false);assert.equal(Object.hasOwn(own,'sealed'),false);
 assert.equal((await (await h.call('network',{owner:'owner-b'})).json()).configured,false);
 assert.equal(provider.requests[0].url,'https://rtc.live.cloudflare.com/v1/turn/keys/'+turnKeyId+'/credentials/generate-ice-servers');
 assert.equal(provider.requests[0].init.headers.Authorization,'Bearer '+turnToken);assert.deepEqual(JSON.parse(provider.requests[0].init.body),{ttl:86400});
});

test('invalid TURN keys cannot replace a verified configuration or leak provider bodies',async t=>{
 const h=harness();turnProvider(t);await configureTurn(h);const before=h.sqlite.prepare('SELECT sealed FROM turn_settings').get().sealed;
 assert.equal((await h.call('network',{method:'POST',owner:'owner-a',data:{keyId:'../arbitrary',apiToken:turnToken}})).status,400);
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:turnToken},{status:401}));
 const r=await h.call('network',{method:'POST',owner:'owner-a',data:{keyId:turnKeyId,apiToken:turnToken+'wrong'}});
 assert.equal(r.status,400);assert.equal((await r.text()).includes(turnToken),false);assert.equal(h.sqlite.prepare('SELECT sealed FROM turn_settings').get().sealed,before);
});

test('TURN cannot be claimed available without a TLS 443 endpoint or encryption secret',async t=>{
 const h=harness();const provider=turnProvider(t,{missingTls:true});
 assert.equal((await h.call('network',{method:'POST',owner:'owner-a',data:{keyId:turnKeyId,apiToken:turnToken}})).status,503);assert.equal(provider.calls,0);
 h.env.TURN_CONFIG_KEY='b'.repeat(64);
 assert.equal((await h.call('network',{method:'POST',owner:'owner-a',data:{keyId:turnKeyId,apiToken:turnToken}})).status,502);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM turn_settings').get().n,0);
});

test('TURN cache renewal does not expire a long-running approved session',async t=>{
 const h=harness(),provider=turnProvider(t),d=await register(h);await online(h,d);await configureTurn(h);const s=await connect(h,d);await active(h,d,s);
 const first=await (await h.call('sessions/'+s.id+'/ice',{token:s.token})).json();
 h.sqlite.prepare('UPDATE turn_credentials SET expires=?').run(Date.now()+1000);
 h.sqlite.prepare('UPDATE sessions SET created=?,expires=? WHERE id=?').run(Date.now()-5*86400000,Date.now()-86400000,s.id);
 const second=await (await h.call('sessions/'+s.id+'/ice',{token:s.token})).json();assert.equal(second.turnEnabled,true);assert.notEqual(second.iceServers[1].username,first.iceServers[1].username);assert.equal(provider.calls,3);
 assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'active');
});

test('removing TURN settings invalidates cached issuance without changing session approvals',async t=>{
 const h=harness(),provider=turnProvider(t),d=await register(h);await online(h,d);await configureTurn(h);const s=await connect(h,d);await active(h,d,s);await h.call('sessions/'+s.id+'/ice',{token:s.token});
 assert.equal((await h.call('network',{owner:'owner-b',method:'DELETE'})).status,200);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM turn_credentials').get().n,1);
 assert.equal((await h.call('network',{owner:'owner-a',method:'DELETE'})).status,200);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM turn_credentials').get().n,0);
 const ice=await (await h.call('sessions/'+s.id+'/ice',{token:s.token})).json();assert.equal(ice.turnEnabled,false);assert.equal(provider.calls,2);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'active');
});

test('quality controls require a capable connector and accept only supported presets for the current session',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 assert.equal(h.sqlite.prepare('SELECT quality FROM sessions WHERE id=?').get(s.id).quality,'high');
 let status=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.equal(status.quality,'high');assert.equal(status.qualitySupported,false);
 const firstPoll=await (await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{screen:true,accessibility:true}}})).json();assert.equal(firstPoll.session.quality,'high');
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'high',generation:0}})).status,409);
 await qualityOnline(h,d);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',data:{quality:'high',generation:0}})).status,401);
 for(const quality of ['invalid',null,{},'__proto__'])assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality,generation:0}})).status,400);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'high',generation:99}})).status,409);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'ultra',generation:0}})).status,200);
 status=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.equal(status.quality,'ultra');assert.equal(status.qualityApplied,null);assert.equal(status.qualitySupported,true);assert.equal(status.status,'active');
 const p=await (await qualityOnline(h,d)).json();assert.equal(p.session.quality,'ultra');
 await qualityOnline(h,d,{session:s.id,generation:0,profile:'ultra'});
 assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).qualityApplied,'ultra');
});

test('view-only guests can choose quality without changing scope or another Mac',async()=>{
 const h=harness(),d=await register(h),other=await register(h,'Other');await qualityOnline(h,d);const s=await connect(h,d,'view');await active(h,d,s);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'low',generation:0}})).status,200);
 await qualityOnline(h,other,{session:s.id,generation:0,profile:'low'});assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 await qualityOnline(h,d,{session:s.id,generation:0,profile:'low'});
 const status=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.equal(status.qualityApplied,'low');assert.equal(status.mode,'view');

});

test('quality survives reconnection, ignores stale acknowledgments and stops on owner revocation',async()=>{
 const h=harness(),d=await register(h);await qualityOnline(h,d);const s=await connect(h,d);await active(h,d,s);
 await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'ultra',generation:0}});await qualityOnline(h,d,{session:s.id,generation:0,profile:'ultra'});
 const r=await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new quality transport',generation:0}});assert.equal(r.status,200);
 let row=h.sqlite.prepare('SELECT quality,quality_applied FROM sessions WHERE id=?').get(s.id);assert.equal(row.quality,'ultra');assert.equal(row.quality_applied,null);
 await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0 answer',generation:1}});
 await qualityOnline(h,d,{session:s.id,generation:0,profile:'ultra'});assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'balanced',generation:1}});
 await qualityOnline(h,d,{session:s.id,generation:1,profile:'ultra'});assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 await qualityOnline(h,d,{session:s.id,generation:1,profile:'balanced'});assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).qualityApplied,'balanced');
 assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 manual quality recovery',generation:1}})).status,200);assert.equal(h.sqlite.prepare('SELECT quality FROM sessions WHERE id=?').get(s.id).quality,'balanced');
 await h.call('devices/'+d.id+'/stop',{owner:'owner-a',method:'POST',data:{}});
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'high',generation:2}})).status,409);
});

test('platform identity headers cannot sign in and browser owner mutations require an Origin',async()=>{
 const h=harness();const spoof={'oai-authenticated-user-id':'owner-a','oai-authenticated-user-email':'owner-a@example.com','x-google-user-id':'owner-a'};
 assert.deepEqual(await (await h.call('me',{headers:spoof})).json(),{signedIn:false,email:null,ownerId:null});
 assert.equal((await h.call('devices',{method:'POST',headers:spoof,data:{name:'forged'}})).status,401);
 const cookie=await h.signedCookie('owner-a');
 const noOrigin=await handleApi(new Request('https://maclink.example/api/devices',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'blocked'})}),h.env);
 assert.equal(noOrigin.status,403);
 assert.equal((await h.call('devices',{headers:{Cookie:cookie+'x'}})).status,401);
});

test('claims require a session, explicit consent and an enabled matching device key',async()=>{
 const h=harness(),d=await register(h);await legacyDevice(h,d);
 assert.equal((await h.call('devices/claim',{method:'POST',data:{device:d.id,token:d.token,confirm:true}})).status,401);
 assert.equal((await claim(h,d,'owner-b',{confirm:false})).status,400);
 assert.equal((await claim(h,d,'owner-b',{token:'a'.repeat(64)})).status,403);
 assert.equal((await h.call('devices/claim',{method:'POST',owner:'owner-b',data:null})).status,400);
 assert.equal((await h.call('devices/claim',{method:'POST',owner:'owner-b',headers:{Origin:'https://evil.example'},data:{device:d.id,token:d.token,confirm:true}})).status,403);
 h.sqlite.prepare('UPDATE devices SET enabled=0 WHERE id=?').run(d.id);
 assert.equal((await claim(h,d)).status,403);
 assert.equal(h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(d.id).owner,'legacy-owner');
});

test('removed HTTPS media and input routes return 404 and status contains no payload queue',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 for(const action of ['relay','input','frame'])for(const method of ['GET','POST'])assert.equal((await h.call('sessions/'+s.id+'/'+action,{method,token:s.token,...(method==='POST'?{data:{events:[{type:'text',text:'never stored'}]}}:{})})).status,404);
 const upload=await handleApi(new Request('https://maclink.example/api/agent/'+d.id+'/frame',{method:'POST',headers:{Authorization:'Bearer '+d.token,'Content-Type':'image/jpeg'},body:new Uint8Array([255,216,255,217])}),h.env);assert.equal(upload.status,404);
 const poll=await (await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).json();assert.equal(poll.session.status,'active');assert.equal('events' in poll,false);assert.equal('frameStatus' in poll,false);assert.equal('transport' in poll.session,false);
 assert.equal(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='inputs'").get(),undefined);
 assert.equal(h.sqlite.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='transport'),false);
});

test('the same Google account sees only its registered Macs and approved connect returns no link',async()=>{
 const h=harness(),d=await register(h);await online(h,d);
 const me=await (await h.call('me',{owner:'owner-a'})).json();assert.deepEqual(me,{signedIn:true,email:'owner-a@example.com',ownerId:'google:owner-a'});
 assert.equal((await h.call('devices')).status,401);
 const foreign=await (await h.call('devices',{owner:'owner-b',email:'owner-a@example.com'})).json();assert.deepEqual(foreign.devices,[]);
 const s=await connect(h,d);assert.equal(s.status,'approved');assert.equal(s.deviceId,d.id);assert.equal(s.ownerId,me.ownerId);assert.equal(s.expires,null);assert.equal('code' in s,false);
 const row=h.sqlite.prepare('SELECT * FROM sessions WHERE id=?').get(s.id);assert.equal(row.owner,me.ownerId);assert.equal(row.auth_session_hash,await hash((await h.cookieFor('owner-a')).split('=')[1]));assert.notEqual(row.guest_hash,s.token);
 const list=await (await h.call('devices',{owner:'owner-a'})).json();assert.equal(list.devices.length,1);assert.equal(list.devices[0].sessions.length,1);
 for(const secret of [d.token,s.token,row.auth_session_hash,'agent_hash','guest_hash','persistentCount'])assert.equal(JSON.stringify(list).includes(secret),false);
});

test('owner cookie is mandatory for device ICE and connect and another Google subject cannot connect',async()=>{
 const h=harness(),d=await register(h);await online(h,d);
 for(const action of ['ice','connect'])for(const owner of [null,'owner-b']){
  const r=await h.call('devices/'+d.id+'/'+action,{method:action==='ice'?'GET':'POST',owner,email:owner?'owner-a@example.com':undefined,data:action==='connect'?{offer:'v=0'}:undefined,token:d.token});assert.equal(r.status,owner?404:401);
 }
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
});

test('offline devices, malformed offers, unsupported modes and parallel requests cannot start extra sessions',async()=>{
 const h=harness(),d=await register(h),route='devices/'+d.id+'/connect';
 assert.equal((await h.call(route,{method:'POST',owner:'owner-a',data:{offer:'v=0'}})).status,409);await online(h,d);
 for(const data of [null,{}, {offer:1},{offer:'invalid'},{offer:'v=0'+'x'.repeat(100000)},{offer:'v=0',mode:'admin'},{offer:'v=0',connectionMode:'https'}])assert.equal((await h.call(route,{method:'POST',owner:'owner-a',data})).status,400);
 const results=await Promise.all(Array.from({length:8},()=>h.call(route,{method:'POST',owner:'owner-a',data:{offer:'v=0',mode:'control'}})));
 assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===409).length,7);
 assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM sessions WHERE status!='ended'").get().n,1);
});

test('session bearer tokens alone, another account, or a different login of the same account never authorize access',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d),otherBrowser=await h.signedCookie('owner-a');
 for(const action of ['', '/ice','/quality','/resume','/end'])for(const identity of ['anonymous','foreign','fresh']){
  const options={owner:identity==='anonymous'?null:identity==='foreign'?'owner-b':'owner-a',token:s.token,...(identity==='fresh'?{headers:{Cookie:otherBrowser}}:{}),...(action==='/quality'||action==='/resume'||action==='/end'?{method:'POST',data:{quality:'high',offer:'v=0 new',generation:0}}:{})};
  assert.equal((await h.call('sessions/'+s.id+action,options)).status,identity==='anonymous'?401:404,identity+action);
 }
 assert.equal((await h.call('sessions/'+s.id,{token:'f'.repeat(64)})).status,404);
 assert.equal((await h.call('sessions/'+s.id,{token:s.token})).status,200);
});

test('cookie-authenticated session mutations require a same-origin request',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d),cookie=await h.cookieFor('owner-a');
 for(const route of ['devices/'+d.id+'/connect','sessions/'+s.id+'/end'])for(const origin of [undefined,'null','https://attacker.example']){
  const response=await handleApi(new Request('https://maclink.example/api/'+route,{method:'POST',headers:{Cookie:cookie,Authorization:'Bearer '+s.token,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({offer:'v=0'})}),h.env);assert.equal(response.status,403);
 }
 assert.equal((await h.call('sessions/'+s.id,{token:s.token,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'approved');
});

test('logout terminates its browser connections while another signed-in computer keeps access to its own Mac',async()=>{
 const h=harness(),a=await register(h,'A'),b=await register(h,'B');await online(h,a);await online(h,b);
 const s=await connect(h,a),cookie=await h.cookieFor('owner-a'),otherCookie=await h.signedCookie('owner-a');
 const other=await connect(h,b,'control',{headers:{Cookie:otherCookie}});await active(h,a,s);await active(h,b,other);
 assert.equal((await h.logout(cookie)).status,303);
 const row=h.sqlite.prepare('SELECT status,offer,answer,generation FROM sessions WHERE id=?').get(s.id);assert.equal(row.status,'ended');assert.equal(row.offer,'');assert.equal(row.answer,null);assert.equal(row.generation,1);
 assert.equal((await h.call('sessions/'+s.id,{token:s.token})).status,401);
 assert.equal((await (await h.call('agent/'+a.id+'/poll',{method:'POST',token:a.token,data:{}})).json()).session,null);
 assert.equal((await (await h.call('sessions/'+other.id,{token:other.token,headers:{Cookie:otherCookie}})).json()).status,'active');
});

test('expired or removed browser logins stop connector authorization and cannot resume',async()=>{
 for(const revoked of ['expired','removed']){
  const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
  if(revoked==='expired')h.sqlite.prepare('UPDATE auth_sessions SET expires=?').run(Date.now()-1);else h.sqlite.exec('DELETE FROM auth_sessions');
  assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0}})).status,401);
  const poll=await (await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).json();assert.equal(poll.session,null);assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'ended');
  assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0 new'}})).status,409);
 }
});

test('logout and ownership races cannot create, answer, or restore a connection using stale authorization',async()=>{
 for(const action of ['connect','answer','resume']){
  const h=harness(),d=await register(h);await online(h,d);const s=action==='connect'?null:await connect(h,d),cookie=await h.cookieFor('owner-a');
  const prepare=h.env.DB.prepare;let race=true;
  h.env.DB.prepare=q=>{const st=prepare(q),run=st.run;st.run=async()=>{if(race&&((action==='connect'&&q.startsWith('INSERT INTO sessions'))||(action==='answer'&&q.startsWith('UPDATE sessions SET answer='))||(action==='resume'&&q.startsWith('UPDATE sessions SET status=?,offer=')))){race=false;await h.logout(cookie);}return run();};return st;};
  const r=action==='connect'?await h.call('devices/'+d.id+'/connect',{method:'POST',owner:'owner-a',data:{offer:'v=0'}}):action==='answer'?await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0'}}):await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0}});
  assert.equal(r.status,409,action);assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM sessions WHERE status!='ended'").get().n,0);
 }
});

test('revoking the current session stops media but permits a deliberate new connection from My devices',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 assert.equal((await h.call('devices/'+d.id+'/stop',{method:'POST',owner:'owner-a',data:{}})).status,200);
 assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'ended');
 assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0}})).status,403);
 assert.equal((await connect(h,d)).status,'approved');
});

test('account approval lasts while the login is valid and old fixed invitation time limits do not apply',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 h.sqlite.prepare('UPDATE sessions SET created=?,expires=? WHERE id=?').run(Date.now()-3*86400000,Date.now()-86400000,s.id);
 assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'active');
});

test('genuinely expired browser and Mac leases suspend active sharing',async()=>{
 for(const lease of ['browser','device']){
  const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
  if(lease==='device')h.sqlite.prepare('UPDATE devices SET seen=? WHERE id=?').run(Date.now()-16000,d.id);else h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-21000,s.id);
  assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'reconnecting');
 }
});

test('a new connection supersedes an abandoned session and the old bearer cannot reclaim control',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d,'view');await active(h,d,s);
 h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);const fresh=await connect(h,d);
 assert.notEqual(fresh.id,s.id);assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 takeover',generation:0}})).status,403);
});

test('device and session ICE are account-bound and temporary TURN credentials are cached and encrypted',async t=>{
 const h=harness(),provider=turnProvider(t),d=await register(h);await online(h,d);await configureTurn(h);
 assert.equal((await h.call('devices/'+d.id+'/ice')).status,401);assert.equal((await h.call('devices/'+d.id+'/ice',{owner:'owner-b'})).status,404);assert.equal(provider.calls,1);
 const ice=await (await h.call('devices/'+d.id+'/ice',{owner:'owner-a'})).json();assert.equal(ice.turnEnabled,true);assert.equal(ice.tls443,true);assert.ok(ice.expiresAt>Date.now()+23*3600000);
 const urls=ice.iceServers.flatMap(s=>s.urls);assert.ok(urls.includes('turns:turn.cloudflare.com:443?transport=tcp'));assert.equal(urls.some(u=>u.includes(':53?')||u.includes('evil.example')),false);
 assert.equal(JSON.stringify(ice).includes(turnToken),false);const row=h.sqlite.prepare('SELECT * FROM turn_credentials').get();assert.equal(row.sealed.includes('temporary-user'),false);assert.equal(row.sealed.includes('temporary-password'),false);
 assert.deepEqual(await (await h.call('devices/'+d.id+'/ice',{owner:'owner-a'})).json(),ice);assert.equal(provider.calls,2);
 const s=await connect(h,d,'view');assert.equal((await h.call('sessions/'+s.id+'/ice',{owner:null,token:s.token})).status,401);assert.equal((await h.call('sessions/'+s.id+'/ice',{token:'f'.repeat(64)})).status,404);
 assert.equal((await (await h.call('sessions/'+s.id+'/ice',{token:s.token})).json()).turnEnabled,true);assert.equal(provider.calls,3);
 await h.call('sessions/'+s.id+'/end',{method:'POST',token:s.token,data:{}});assert.equal((await h.call('sessions/'+s.id+'/ice',{token:s.token})).status,403);
});

test('provider outage or damaged encrypted configuration preserves direct connectivity',async t=>{
 const h=harness(),d=await register(h);await online(h,d);turnProvider(t);await configureTurn(h);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error(turnToken);});
 let ice=await (await h.call('devices/'+d.id+'/ice',{owner:'owner-a'})).json();assert.equal(ice.turnEnabled,false);assert.equal(ice.tls443,false);assert.ok(ice.warning);assert.deepEqual(ice.iceServers,[{urls:['stun:stun.cloudflare.com:3478']}]);assert.equal(JSON.stringify(ice).includes(turnToken),false);
 h.sqlite.prepare("UPDATE turn_settings SET sealed='broken' WHERE owner=?").run('google:owner-a');ice=await (await h.call('devices/'+d.id+'/ice',{owner:'owner-a'})).json();assert.equal(ice.turnEnabled,false);assert.equal(JSON.stringify(ice).includes(turnToken),false);
});

test('confirmed legacy claims preserve the connector key and revoke sessions without granting access by email',async()=>{
 const h=harness(),d=await register(h),sibling=await register(h,'Other');await online(h,d);const s=await connect(h,d);await active(h,d,s);await legacyDevice(h,d);await legacyDevice(h,sibling);
 assert.equal((await (await h.call('devices',{owner:'owner-b',email:'owner-a@example.com'})).json()).devices.length,0);
 const result=await claim(h,d);assert.equal(result.status,200);assert.equal((await result.json()).alreadyOwned,false);
 assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'ended');assert.equal(h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(sibling.id).owner,'legacy-owner');
 await online(h,d);assert.equal((await connect(h,d,'control',{owner:'owner-b'})).ownerId,'google:owner-b');assert.equal((await claim(h,d,'owner-a')).status,409);
});

test('a repeated successful claim cannot revoke a fresh account connection and competing claims have one winner',async()=>{
 const h=harness(),d=await register(h);await online(h,d);await legacyDevice(h,d);
 const results=await Promise.all([claim(h,d,'owner-b'),claim(h,d,'owner-c')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const winner=h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(d.id).owner.slice(7),loser=winner==='owner-b'?'owner-c':'owner-b';const s=await connect(h,d,'control',{owner:winner});await active(h,d,s);
 assert.equal((await claim(h,d,winner)).status,200);assert.equal((await claim(h,d,loser)).status,409);assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'active');
});

test('a full target account cannot move a legacy device or revoke its existing history',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await legacyDevice(h,d);
 for(let i=0;i<8;i++)assert.equal((await h.call('devices',{method:'POST',owner:'owner-b',data:{name:'Mac '+i}})).status,201);
 assert.equal((await claim(h,d)).status,409);assert.equal(h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(d.id).owner,'legacy-owner');assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'approved');
});

test('session diagnostics expose only fixed audio capability fields and safe errors',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);
 for(const [info,expected] of [[{},[false,false,null]],[{audioSupported:true,audioAvailable:true},[true,true,null]],[{audioSupported:'yes',audioAvailable:1,audioError:d.token},[false,false,null]],...[ 'permission','unavailable','capture-failed'].map(audioError=>[{audioSupported:true,audioError},[true,false,audioError]])]){
  h.sqlite.prepare('UPDATE devices SET info=? WHERE id=?').run(JSON.stringify(info),d.id);const body=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.deepEqual([body.audioSupported,body.audioAvailable,body.audioError],expected);assert.equal(JSON.stringify(body).includes(d.token),false);
 }
});

test('migration removes invitation data and rejects populated legacy sessions before runtime cleanup',async()=>{
 const h=harness(),d=await register(h),sqlite=new DatabaseSync(':memory:');
 const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();for(const file of migrations.filter(f=>f<'0007_'))sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 sqlite.prepare('INSERT INTO devices (id,owner,name,agent_hash,created,seen,enabled,info) VALUES (?,?,?,?,?, ?,1,?)').run(d.id,'google:owner-a','Legacy',await hash(d.token),Date.now(),Date.now(),'{}');
 sqlite.prepare('INSERT INTO invites (id,device,secret_hash,mode,expires,used,reusable) VALUES (?,?,?,?,?,0,1)').run('old-invite',d.id,'old-secret','control',0);
 sqlite.prepare('INSERT INTO sessions (id,device,invite,guest_hash,guest_name,mode,status,offer,answer,created,expires,seen,generation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)').run('old-session',d.id,'old-invite',await hash('a'.repeat(64)),'Legacy','control','active','v=0 old','v=0 answer',Date.now(),0,Date.now());
 const migration=readFileSync(new URL('../drizzle/0007_account_devices.sql',import.meta.url),'utf8');assert.equal(/\b(?:UPDATE|DELETE|INSERT)\b/i.test(migration),false);sqlite.exec(migration);
 for(const name of ['invites','invite_verifications','owner_identities'])assert.equal(sqlite.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name),undefined);
 const old=sqlite.prepare('SELECT * FROM sessions').get();assert.equal(old.owner,null);assert.equal(old.auth_session_hash,null);assert.equal('invite' in old,false);
 const auth=await h.cookieFor('owner-a');const row=h.sqlite.prepare('SELECT * FROM auth_users').get();sqlite.prepare('INSERT INTO auth_users (id,google_sub,email,name,created,updated) VALUES (?,?,?,?,?,?)').run(row.id,row.google_sub,row.email,row.name,row.created,row.updated);const login=h.sqlite.prepare('SELECT * FROM auth_sessions').get();sqlite.prepare('INSERT INTO auth_sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)').run(login.token_hash,login.user_id,login.created,login.expires);
 const env={...h.env,DB:{prepare(q){let args=[];return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(q).get(...args)||null;},async all(){return {results:sqlite.prepare(q).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(q).run(...args).changes)}};}};},async batch(stmts){return Promise.all(stmts.map(s=>s.run()));}}};
 assert.equal((await handleApi(new Request('https://maclink.example/api/sessions/old-session',{headers:{Cookie:auth,Authorization:'Bearer '+'a'.repeat(64)}}),env)).status,404);
 const poll=await handleApi(new Request('https://maclink.example/api/agent/'+d.id+'/poll',{method:'POST',headers:{Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:'{}'}),env);assert.equal((await poll.json()).session,null);assert.equal(sqlite.prepare('SELECT status FROM sessions').get().status,'ended');
});

test('removed public invitation and consent APIs stay unavailable even to a signed-in owner',async()=>{
 const h=harness(),d=await register(h);await online(h,d);
 for(const path of ['join','ice','devices/'+d.id+'/invite','devices/'+d.id+'/decision','agent/'+d.id+'/decision'])for(const owner of [null,'owner-a'])assert.equal((await h.call(path,{method:'POST',owner,token:d.token,data:{code:'a'.repeat(24)+'.'+'b'.repeat(64),hostEmail:'owner-a@example.com',offer:'v=0',allow:true}})).status,404,path);
});


test('a logout completing during the browser heartbeat returns ended without the old answer',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await connect(h,d);await active(h,d,s);const cookie=await h.cookieFor('owner-a');
 const prepare=h.env.DB.prepare;let race=true;
 h.env.DB.prepare=q=>{const st=prepare(q),run=st.run;st.run=async()=>{if(race&&q.startsWith('UPDATE sessions SET seen=')){race=false;await h.logout(cookie);}return run();};return st;};
 const response=await h.call('sessions/'+s.id,{token:s.token});assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,'ended');assert.equal(result.answer,null);
 assert.equal((await (await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).json()).session,null);
});
