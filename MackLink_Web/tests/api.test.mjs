import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {handleApi,normalizeHostEmail,hash} from '../lib/server.ts';
function harness(){
 const sqlite=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 function prepare(q){let args=[];return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(q).get(...args)||null;},async all(){return {results:sqlite.prepare(q).all(...args)};},async run(){const r=sqlite.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}};}};}
 let batchQueue=Promise.resolve();
 const env={AUTH_BASE_URL:'https://maclink.example',DB:{prepare,async batch(stmts){const result=batchQueue.then(async()=>{sqlite.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}});batchQueue=result.catch(()=>{});return result;}}};
 async function signedCookie(owner,email=owner+'@example.com'){
  const id='google:'+owner,token=randomBytes(32).toString('base64url'),now=Date.now();
  sqlite.prepare('INSERT INTO auth_users (id,google_sub,email,name,created,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email').run(id,owner,email,null,now,now);
  sqlite.prepare('INSERT INTO auth_sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,now,now+3600000);
  return '__Host-maclink_session='+token;
 }
 async function call(path,{method='GET',data,owner,email=owner?owner+'@example.com':undefined,token,headers={}}={}){
  const h={...(owner&&method!=='GET'?{Origin:'https://maclink.example'}:{}),...headers};
  if(owner&&email)h.Cookie=await signedCookie(owner,email);
  if(token)h.Authorization='Bearer '+token;
  let body;if(data!==undefined){body=JSON.stringify(data);h['Content-Type']='application/json';}
  return handleApi(new Request('https://maclink.example/api/'+path,{method,headers:h,body}),env);
 }
 return {call,signedCookie,sqlite,env};
}
async function register(h,name='Mac'){const r=await h.call('devices',{method:'POST',owner:'owner-a',data:{name}});assert.equal(r.status,201);return r.json();}
async function online(h,d){const r=await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{screen:true,accessibility:true}}});assert.equal(r.status,200);}
async function invitation(h,d,mode='control'){const r=await h.call('devices/'+d.id+'/invite',{method:'POST',owner:'owner-a',data:{mode}});assert.equal(r.status,200);return r.json();}
async function join(h,i){const r=await h.call('join',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code,name:'Guest',offer:'v=0\r\n'}});assert.equal(r.status,201);return r.json();}
async function active(h,d,s){let r=await h.call('agent/'+d.id+'/decision',{method:'POST',token:d.token,data:{session:s.id,allow:true}});assert.equal(r.status,200);r=await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0\r\n'}});assert.equal(r.status,200);}

test('anonymous and other owners cannot manage devices; secrets are not returned in list',async()=>{const h=harness();assert.equal((await h.call('devices')).status,401);const d=await register(h);assert.equal((await h.call('devices/'+d.id+'/invite',{method:'POST',owner:'owner-b',data:{}})).status,404);assert.equal((await h.call('agent/'+d.id+'/poll',{method:'POST',data:{},token:'a'.repeat(64)})).status,401);const list=await (await h.call('devices',{owner:'owner-a'})).json();assert.equal(list.devices.length,1);assert.equal(JSON.stringify(list).includes(d.token),false);assert.equal(JSON.stringify(list).includes('agent_hash'),false);});
test('offline devices refuse joins; invitation is single use; one guest per device',async()=>{const h=harness(),d=await register(h),i=await invitation(h,d);assert.equal((await h.call('join',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code,name:'G',offer:'v=0'}})).status,409);await online(h,d);const s=await join(h,i);assert.equal((await h.call('join',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code,name:'G',offer:'v=0'}})).status,410);const i2=await invitation(h,d);assert.equal((await h.call('join',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i2.code,name:'G',offer:'v=0'}})).status,409);assert.equal((await h.call('sessions/'+s.id)).status,401);});
test('approval gates answers and owner stop revokes active WebRTC immediately',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0'}})).status,409);await active(h,d,s);await h.call('devices/'+d.id+'/stop',{method:'POST',owner:'owner-a',data:{}});assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'ended');assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0}})).status,403);});
test('view-only sessions keep their scope across status and resume',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await persistent(h,d,'view'));await active(h,d,s);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).mode,'view');assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0,mode:'control'}})).status,200);assert.equal(h.sqlite.prepare('SELECT mode FROM sessions WHERE id=?').get(s.id).mode,'view');});
test('another enrolled Mac cannot answer this session',async()=>{const h=harness(),a=await register(h,'A'),b=await register(h,'B');await online(h,a);const s=await join(h,await invitation(h,a));assert.equal((await h.call('agent/'+b.id+'/answer',{method:'POST',token:b.token,data:{session:s.id,answer:'v=0'}})).status,409);});
test('network leases suspend sessions; registry removal invalidates native key',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));await active(h,d,s);h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'reconnecting');await h.call('devices/'+d.id,{method:'DELETE',owner:'owner-a'});assert.equal((await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).status,401);});
test('cleanup and guest expiry cannot suspend a heartbeat that completed after their stale read',async t=>{
 for(const route of ['cleanup','guest'])await t.test(route,async()=>{
  const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));await active(h,d,s);
  let clock=Date.now();t.mock.method(Date,'now',()=>clock);
  h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(clock-19999,s.id);
  const prepare=h.env.DB.prepare;let releaseHeartbeat,heartbeatStarted;
  const started=new Promise(resolve=>{heartbeatStarted=resolve;}),release=new Promise(resolve=>{releaseHeartbeat=resolve;});
  let pendingHeartbeat;
  h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run,all=statement.all;
   statement.run=async()=>{
    if(q==='UPDATE sessions SET seen=? WHERE id=?'&&!pendingHeartbeat){pendingHeartbeat=true;heartbeatStarted();await release;}
    if(route==='guest'&&q.startsWith('UPDATE sessions SET status=CASE WHEN')){releaseHeartbeat();await heartbeat;}
    return run();
   };
   statement.all=async()=>{const rows=await all();if(route==='cleanup'&&q.startsWith("SELECT * FROM sessions WHERE device=? AND status IN ('pending','approved','active') AND seen<")&&rows.results.length){releaseHeartbeat();await heartbeat;}return rows;};
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
 const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));await active(h,d,s);
 h.sqlite.prepare('UPDATE devices SET seen=? WHERE id=?').run(Date.now()-16000,d.id);
 const prepare=h.env.DB.prepare;let race=true;
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{if(race&&q.startsWith('UPDATE sessions SET status=CASE WHEN')){race=false;await online(h,d);}return run();};return statement;};
 const response=await h.call('sessions/'+s.id,{token:s.token});assert.equal(response.status,200);assert.equal((await response.json()).status,'active');
});
test('genuinely expired guest and Mac leases still stop active sharing, and expired pending requests end',async()=>{
 for(const lease of ['guest','device','pending']){
  const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));
  if(lease!=='pending')await active(h,d,s);

  if(lease==='device')h.sqlite.prepare('UPDATE devices SET seen=? WHERE id=?').run(Date.now()-16000,d.id);
  else h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-21000,s.id);
  const response=await h.call('sessions/'+s.id,{token:s.token});assert.equal(response.status,200);assert.equal((await response.json()).status,lease==='pending'?'ended':'reconnecting');
 }
});
test('expiry racing with owner revocation returns the ended session without restoring access',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));await active(h,d,s);
 h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);
 const prepare=h.env.DB.prepare;let race=true;
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{if(race&&q.startsWith('UPDATE sessions SET status=CASE WHEN')){race=false;assert.equal((await h.call('devices/'+d.id+'/stop',{method:'POST',owner:'owner-a',data:{}})).status,200);}return run();};return statement;};
 const response=await h.call('sessions/'+s.id,{token:s.token});assert.equal(response.status,200);assert.equal((await response.json()).status,'ended');
 assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0}})).status,403);
});
test('unchanged quality reports avoid repeated row writes and stale reports cannot overwrite a new request',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));await active(h,d,s);
 const prepare=h.env.DB.prepare,writes=[];
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{const result=await run();if(q.startsWith('UPDATE sessions SET quality_applied='))writes.push(result.meta.changes);return result;};return statement;};
 const report=profile=>h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{qualityControl:true,quality:{session:s.id,generation:0,profile}}}});
 assert.equal((await report('balanced')).status,200);assert.equal((await report('balanced')).status,200);assert.deepEqual(writes,[1,0]);
 h.sqlite.prepare("UPDATE sessions SET quality='low',quality_applied=NULL WHERE id=?").run(s.id);
 assert.equal((await report('balanced')).status,200);assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 assert.equal((await report('low')).status,200);assert.deepEqual(writes,[1,0,0,1]);
});
test('session diagnostics expose only a validated connector version',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d));await active(h,d,s);
 for(const [version,expected] of [['1.2.2','1.2.2'],['1.2.3-beta',null],[d.token,null],[{secret:d.token},null],[null,null]]){
  h.sqlite.prepare('UPDATE devices SET info=? WHERE id=?').run(JSON.stringify({version}),d.id);
  const response=await h.call('sessions/'+s.id,{token:s.token}),result=await response.json();assert.equal(response.status,200);assert.equal(result.connectorVersion,expected);assert.equal(JSON.stringify(result).includes(d.token),false);
 }
});
test('cross-origin owner mutations fail closed',async()=>{const h=harness();assert.equal((await h.call('devices',{method:'POST',owner:'owner-a',headers:{Origin:'https://evil.example'},data:{name:'bad'}})).status,403);});
async function persistent(h,d,mode='control'){const r=await h.call('devices/'+d.id+'/invite',{method:'POST',owner:'owner-a',data:{mode,reusable:true}});assert.equal(r.status,200);const i=await r.json();assert.equal(i.expires,0);assert.equal(i.reusable,true);return i;}
test('persistent invitation authorizes immediately without a Mac approval and can be used again',async()=>{const h=harness(),d=await register(h);await online(h,d);const i=await persistent(h,d),s=await join(h,i);assert.equal(s.status,'approved');assert.equal(s.expires,null);assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0\r\n'}})).status,200);await h.call('sessions/'+s.id+'/end',{method:'POST',token:s.token,data:{}});const s2=await join(h,i);assert.equal(s2.status,'approved');assert.notEqual(s.id,s2.id);});
test('active sessions and persistent invitation remain usable after the old two-hour and one-hour limits',async()=>{const h=harness(),d=await register(h);await online(h,d);const i=await persistent(h,d),s=await join(h,i);await active(h,d,s);h.sqlite.prepare('UPDATE sessions SET created=?,expires=? WHERE id=?').run(Date.now()-3*86400000,Date.now()-86400000,s.id);const r=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.equal(r.status,'active');assert.equal(r.expires,null);await h.call('sessions/'+s.id+'/end',{method:'POST',token:s.token,data:{}});h.sqlite.prepare('UPDATE invites SET expires=? WHERE id=?').run(Date.now()-86400000,i.code.split('.')[0]);assert.equal((await join(h,i)).status,'approved');});
test('network lease loss stops media/input but resumes approved rights without another consent',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await persistent(h,d));await active(h,d,s);h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);const poll=await (await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).json();assert.equal(poll.session,null);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'reconnecting');let r=await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0\r\no=new',generation:0}});assert.equal(r.status,200);assert.deepEqual(await r.json(),{generation:1,status:'approved'});assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:0,answer:'v=0 old'}})).status,409);assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:1,answer:'v=0 new'}})).status,200);});
test('native restart requests recovery; explicit owner revocation prevents resume and reuse',async()=>{const h=harness(),d=await register(h);await online(h,d);const i=await persistent(h,d),s=await join(h,i);await active(h,d,s);assert.equal((await h.call('agent/'+d.id+'/recover',{method:'POST',token:d.token,data:{session:s.id,generation:0}})).status,200);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'reconnecting');await h.call('devices/'+d.id+'/stop',{method:'POST',owner:'owner-a',data:{}});assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0',generation:0}})).status,403);assert.equal((await h.call('join',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code,name:'G',offer:'v=0'}})).status,410);});
test('resume cannot elevate pending or read-only scopes, and a superseded guest cannot reclaim control',async()=>{const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await invitation(h,d,'view'));let r=await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new',generation:0}});assert.equal(r.status,200);assert.equal((await r.json()).status,'pending');assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:1,answer:'v=0'}})).status,409);await h.call('agent/'+d.id+'/decision',{method:'POST',token:d.token,data:{session:s.id,allow:true}});await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:1,answer:'v=0'}});h.sqlite.prepare('UPDATE sessions SET seen=? WHERE id=?').run(Date.now()-30000,s.id);await join(h,await persistent(h,d));assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new2',generation:1}})).status,403);});
test('a late answer cannot cross a concurrent connection restart',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await persistent(h,d));
 const prepare=h.env.DB.prepare;let race='answer';
 h.env.DB.prepare=q=>{const statement=prepare(q),run=statement.run;statement.run=async()=>{
  if(race==='answer'&&q.startsWith('UPDATE sessions SET answer=')){race='';h.sqlite.prepare("UPDATE sessions SET generation=1,offer='v=0 newer',answer=NULL WHERE id=?").run(s.id);}
  return run();};return statement;};
 assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:0,answer:'v=0 old'}})).status,409);
 assert.equal(h.sqlite.prepare('SELECT answer FROM sessions WHERE id=?').get(s.id).answer,null);
 assert.equal((await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,generation:1,answer:'v=0 current'}})).status,200);
 race='input';


});
test('owner revocation also stops a guest joining just as revocation begins',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await persistent(h,d),batch=h.env.DB.batch;let s;
 h.env.DB.batch=async statements=>{h.env.DB.batch=batch;s=await join(h,i);return batch(statements);};
 assert.equal((await h.call('devices/'+d.id+'/stop',{method:'POST',owner:'owner-a',data:{}})).status,200);
 assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'ended');
 assert.equal((await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 newer',generation:0}})).status,403);
 assert.equal((await h.call('join',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code,name:'G',offer:'v=0'}})).status,410);
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
test('only a valid unrevoked invitation can retrieve ICE; temporary credentials are cached and sealed',async t=>{
 const h=harness(),provider=turnProvider(t),d=await register(h);await online(h,d);await configureTurn(h);const i=await persistent(h,d);
 assert.equal((await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:'bad'}})).status,400);
 assert.equal((await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code.slice(0,-1)+(i.code.endsWith('f')?'a':'f')}})).status,410);
 assert.equal(provider.calls,1);
 const ice=await (await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code}})).json();assert.equal(ice.turnEnabled,true);assert.equal(ice.tls443,true);assert.ok(ice.expiresAt>Date.now()+23*3600000);
 const urls=ice.iceServers.flatMap(s=>s.urls);assert.ok(urls.includes('turns:turn.cloudflare.com:443?transport=tcp'));assert.equal(urls.some(u=>u.includes(':53?')||u.includes('evil.example')),false);
 assert.equal(JSON.stringify(ice).includes(turnToken),false);
 const row=h.sqlite.prepare('SELECT * FROM turn_credentials').get();assert.equal(row.sealed.includes('temporary-user'),false);assert.equal(row.sealed.includes('temporary-password'),false);
 const again=await (await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code}})).json();assert.deepEqual(again,ice);assert.equal(provider.calls,2);
 await h.call('devices/'+d.id+'/stop',{owner:'owner-a',method:'POST',data:{}});
 assert.equal((await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code}})).status,410);assert.equal(provider.calls,2);
});
test('single-use invitation ICE access expires on redemption and session access takes over',async t=>{
 const h=harness(),provider=turnProvider(t),d=await register(h);await online(h,d);await configureTurn(h);const i=await invitation(h,d,'view');
 assert.equal((await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code}})).status,200);
 const s=await join(h,i);assert.equal((await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code}})).status,410);
 assert.equal((await h.call('sessions/'+s.id+'/ice')).status,401);
 assert.equal((await h.call('sessions/'+s.id+'/ice',{token:'f'.repeat(64)})).status,404);
 const response=await h.call('sessions/'+s.id+'/ice',{token:s.token});assert.equal(response.status,200);assert.equal((await response.json()).turnEnabled,true);assert.equal(provider.calls,3);
 assert.equal(h.sqlite.prepare('SELECT mode,status FROM sessions WHERE id=?').get(s.id).mode,'view');
 await h.call('sessions/'+s.id+'/end',{token:s.token,method:'POST',data:{}});
 assert.equal((await h.call('sessions/'+s.id+'/ice',{token:s.token})).status,403);assert.equal(provider.calls,3);
});
test('TURN cache renewal does not expire a long-running approved session',async t=>{
 const h=harness(),provider=turnProvider(t),d=await register(h);await online(h,d);await configureTurn(h);const s=await join(h,await persistent(h,d));await active(h,d,s);
 const first=await (await h.call('sessions/'+s.id+'/ice',{token:s.token})).json();
 h.sqlite.prepare('UPDATE turn_credentials SET expires=?').run(Date.now()+1000);
 h.sqlite.prepare('UPDATE sessions SET created=?,expires=? WHERE id=?').run(Date.now()-5*86400000,Date.now()-86400000,s.id);
 const second=await (await h.call('sessions/'+s.id+'/ice',{token:s.token})).json();assert.equal(second.turnEnabled,true);assert.notEqual(second.iceServers[1].username,first.iceServers[1].username);assert.equal(provider.calls,3);
 assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'active');
});
test('provider outage or damaged encrypted configuration preserves direct connectivity and reports TURN unavailable',async t=>{
 const h=harness(),d=await register(h);await online(h,d);turnProvider(t);await configureTurn(h);const i=await persistent(h,d);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error(turnToken);});
 let ice=await (await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code}})).json();assert.equal(ice.turnEnabled,false);assert.equal(ice.tls443,false);assert.ok(ice.warning);assert.deepEqual(ice.iceServers,[{urls:['stun:stun.cloudflare.com:3478']}]);assert.equal(JSON.stringify(ice).includes(turnToken),false);
 h.sqlite.prepare("UPDATE turn_settings SET sealed='damaged'").run();
 ice=await (await h.call('ice',{method:'POST',data:{hostEmail:'owner-a@example.com',code:i.code}})).json();assert.equal(ice.turnEnabled,false);assert.ok(ice.warning);
});
test('removing TURN settings invalidates cached issuance without changing session approvals',async t=>{
 const h=harness(),provider=turnProvider(t),d=await register(h);await online(h,d);await configureTurn(h);const s=await join(h,await persistent(h,d));await active(h,d,s);await h.call('sessions/'+s.id+'/ice',{token:s.token});
 assert.equal((await h.call('network',{owner:'owner-b',method:'DELETE'})).status,200);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM turn_credentials').get().n,1);
 assert.equal((await h.call('network',{owner:'owner-a',method:'DELETE'})).status,200);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM turn_credentials').get().n,0);
 const ice=await (await h.call('sessions/'+s.id+'/ice',{token:s.token})).json();assert.equal(ice.turnEnabled,false);assert.equal(provider.calls,2);assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).status,'active');
});

async function qualityOnline(h,d,report){
 h.sqlite.prepare('UPDATE devices SET seen=0 WHERE id=?').run(d.id);
 return h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{info:{version:'1.2.0',screen:true,accessibility:true,qualityControl:true,...(report?{quality:report}:{})}}});
}
test('quality controls require a capable connector and accept only supported presets for the current session',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await persistent(h,d));await active(h,d,s);
 let status=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.equal(status.quality,'balanced');assert.equal(status.qualitySupported,false);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'high',generation:0}})).status,409);
 await qualityOnline(h,d);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',data:{quality:'high',generation:0}})).status,401);
 for(const quality of ['invalid',null,{},'__proto__'])assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality,generation:0}})).status,400);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'high',generation:99}})).status,409);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'high',generation:0}})).status,200);
 status=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.equal(status.quality,'high');assert.equal(status.qualityApplied,null);assert.equal(status.qualitySupported,true);assert.equal(status.status,'active');
 const p=await (await qualityOnline(h,d)).json();assert.equal(p.session.quality,'high');
 await qualityOnline(h,d,{session:s.id,generation:0,profile:'high'});
 assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).qualityApplied,'high');
});
test('view-only guests can choose quality without changing scope or another Mac',async()=>{
 const h=harness(),d=await register(h),other=await register(h,'Other');await qualityOnline(h,d);const s=await join(h,await persistent(h,d,'view'));await active(h,d,s);
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'low',generation:0}})).status,200);
 await qualityOnline(h,other,{session:s.id,generation:0,profile:'low'});assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 await qualityOnline(h,d,{session:s.id,generation:0,profile:'low'});
 const status=await (await h.call('sessions/'+s.id,{token:s.token})).json();assert.equal(status.qualityApplied,'low');assert.equal(status.mode,'view');

});
test('quality survives reconnection, ignores stale acknowledgments and stops on owner revocation',async()=>{
 const h=harness(),d=await register(h);await qualityOnline(h,d);const s=await join(h,await persistent(h,d));await active(h,d,s);
 await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'ultra',generation:0}});await qualityOnline(h,d,{session:s.id,generation:0,profile:'ultra'});
 const r=await h.call('sessions/'+s.id+'/resume',{method:'POST',token:s.token,data:{offer:'v=0 new quality transport',generation:0}});assert.equal(r.status,200);
 let row=h.sqlite.prepare('SELECT quality,quality_applied FROM sessions WHERE id=?').get(s.id);assert.equal(row.quality,'ultra');assert.equal(row.quality_applied,null);
 await h.call('agent/'+d.id+'/answer',{method:'POST',token:d.token,data:{session:s.id,answer:'v=0 answer',generation:1}});
 await qualityOnline(h,d,{session:s.id,generation:0,profile:'ultra'});assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'balanced',generation:1}});
 await qualityOnline(h,d,{session:s.id,generation:1,profile:'ultra'});assert.equal(h.sqlite.prepare('SELECT quality_applied FROM sessions WHERE id=?').get(s.id).quality_applied,null);
 await qualityOnline(h,d,{session:s.id,generation:1,profile:'balanced'});assert.equal((await (await h.call('sessions/'+s.id,{token:s.token})).json()).qualityApplied,'balanced');
 await h.call('devices/'+d.id+'/stop',{owner:'owner-a',method:'POST',data:{}});
 assert.equal((await h.call('sessions/'+s.id+'/quality',{method:'POST',token:s.token,data:{quality:'high',generation:1}})).status,409);
});

test('host email is normalized without alias rewriting and malformed values fail closed',()=>{
 assert.equal(normalizeHostEmail('  Host@Example.COM  '),'host@example.com');
 assert.notEqual(normalizeHostEmail('host+mac@example.com'),normalizeHostEmail('host@example.com'));
 for(const email of [null,{},[],42,'','owner','a@b','a@b@c.com','a b@example.com','x'.repeat(250)+'@example.com'])assert.equal(normalizeHostEmail(email),null);
});
test('only the Google session owner enrolls the host email; public APIs never reveal it',async()=>{
 const h=harness();
 assert.deepEqual(await (await h.call('me')).json(),{signedIn:false,email:null});
 assert.equal((await h.call('devices',{method:'POST',owner:'owner-a',email:null,data:{name:'Mac',email:'attacker@example.com'}})).status,401);
 const d=await register(h);await online(h,d);const i=await invitation(h,d);
 const me=await (await h.call('me',{owner:'owner-a'})).json();assert.equal(me.email,'owner-a@example.com');
 const row=h.sqlite.prepare('SELECT * FROM owner_identities').get();assert.equal(row.owner,'google:owner-a');assert.match(row.email_hash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(row).includes(me.email),false);
 for(const path of ['ice','join']){
  const response=await h.call(path,{method:'POST',data:{code:i.code,hostEmail:'attacker@example.com',ownerEmail:'attacker@example.com',offer:'v=0'}});
  assert.equal(response.status,403);const text=await response.text();assert.equal(text.includes(me.email),false);assert.equal(text.includes(row.email_hash),false);
 }
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
 assert.equal(h.sqlite.prepare('SELECT used FROM invites WHERE id=?').get(i.code.split('.')[0]).used,0);
});
test('direct ICE and join calls require the correct host email, including legacy name-only calls',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await invitation(h,d);
 for(const path of ['ice','join']){
  for(const hostEmail of [undefined,'',{},'bad','other@example.com']){
   const r=await h.call(path,{method:'POST',data:{code:i.code,name:'Forged name',hostEmail,offer:'v=0'}});
   assert.equal(r.status,hostEmail==='other@example.com'?403:400);
  }
 }
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM turn_credentials').get().n,0);
 assert.equal((await h.call('ice',{method:'POST',data:{code:i.code,hostEmail:'  OWNER-A@EXAMPLE.COM  '}})).status,200);
 const r=await h.call('join',{method:'POST',data:{code:i.code,hostEmail:'  OWNER-A@EXAMPLE.COM  ',name:'Host pretending to be guest',offer:'v=0'}});assert.equal(r.status,201);
 const s=await r.json();assert.equal(s.status,'pending');
 assert.equal(h.sqlite.prepare('SELECT guest_name FROM sessions WHERE id=?').get(s.id).guest_name,'Remote visitor');
});
test('an email enrolled under another owner cannot authorize this invitation',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await invitation(h,d);
 await h.call('me',{owner:'owner-b',email:'other@example.com'});
 const r=await h.call('join',{method:'POST',owner:'owner-b',email:'other@example.com',data:{code:i.code,hostEmail:'other@example.com',offer:'v=0'}});assert.equal(r.status,403);
 assert.equal((await h.call('join',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com',offer:'v=0'}})).status,201);
});
test('existing devices require authenticated email enrollment; no fallback to caller-supplied identity',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await invitation(h,d);
 h.sqlite.exec('DELETE FROM owner_identities');
 assert.equal((await h.call('ice',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com'}})).status,403);
 await h.call('me',{owner:'owner-b',email:'owner-a@example.com'});
 assert.equal((await h.call('join',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com',offer:'v=0'}})).status,403);
 await h.call('me',{owner:'owner-a'});
 assert.equal((await h.call('ice',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com'}})).status,200);
});
test('ICE and join share a persistent per-invite failure limit with bounded recovery',async t=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await invitation(h,d);let now=Date.now();t.mock.method(Date,'now',()=>now);
 for(let attempt=0;attempt<10;attempt++)assert.equal((await h.call(attempt%2?'join':'ice',{method:'POST',data:{code:i.code,hostEmail:'wrong@example.com',offer:'v=0'}})).status,403);
 for(const path of ['ice','join'])assert.equal((await h.call(path,{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com',offer:'v=0'}})).status,429);
 const i2=await invitation(h,d);assert.equal((await h.call('ice',{method:'POST',data:{code:i2.code,hostEmail:'owner-a@example.com'}})).status,200);
 now+=300001;await online(h,d);
 assert.equal((await h.call('ice',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com'}})).status,200);
 assert.equal((await h.call('join',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com',offer:'v=0'}})).status,201);
});

test('parallel email guesses cannot exceed the shared ICE/join verification budget',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await invitation(h,d);
 const results=await Promise.all(Array.from({length:30},(_,index)=>h.call(index%2?'ice':'join',{method:'POST',data:{code:i.code,hostEmail:'guess'+index+'@example.com',offer:'v=0'}})));
 assert.equal(results.filter(r=>r.status===403).length,10);
 assert.equal(results.filter(r=>r.status===429).length,20);
 assert.equal(h.sqlite.prepare('SELECT failures FROM invite_verifications WHERE invite=?').get(i.code.split('.')[0]).failures,10);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
});
test('successful checks refund slots without resetting earlier failed guesses',async()=>{
 const h=harness(),d=await register(h);const i=await invitation(h,d);
 assert.equal((await h.call('ice',{method:'POST',data:{code:i.code,hostEmail:'wrong@example.com'}})).status,403);
 for(let index=0;index<15;index++)assert.equal((await h.call('ice',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com'}})).status,200);
 assert.equal(h.sqlite.prepare('SELECT failures FROM invite_verifications WHERE invite=?').get(i.code.split('.')[0]).failures,1);
});

async function legacyDevice(h,d,owner='legacy-owner'){
 h.sqlite.prepare('UPDATE devices SET owner=? WHERE id=?').run(owner,d.id);
 h.sqlite.prepare('INSERT INTO owner_identities (owner,email_hash,updated) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET email_hash=excluded.email_hash').run(owner,await hash('host-email:'+owner+':owner-a@example.com'),Date.now());
}
const claim=(h,d,owner='owner-b',extra={})=>h.call('devices/claim',{method:'POST',owner,data:{device:d.id,token:d.token,confirm:true,...extra}});

test('platform identity headers cannot sign in and browser owner mutations require an Origin',async()=>{
 const h=harness();const spoof={'oai-authenticated-user-id':'owner-a','oai-authenticated-user-email':'owner-a@example.com','x-google-user-id':'owner-a'};
 assert.deepEqual(await (await h.call('me',{headers:spoof})).json(),{signedIn:false,email:null});
 assert.equal((await h.call('devices',{method:'POST',headers:spoof,data:{name:'forged'}})).status,401);
 const cookie=await h.signedCookie('owner-a');
 const noOrigin=await handleApi(new Request('https://maclink.example/api/devices',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'blocked'})}),h.env);
 assert.equal(noOrigin.status,403);
 assert.equal((await h.call('devices',{headers:{Cookie:cookie+'x'}})).status,401);
});

test('same email on a new Google identity never automatically takes a legacy device',async()=>{
 const h=harness(),d=await register(h);await legacyDevice(h,d);
 const me=await (await h.call('me',{owner:'owner-b',email:'owner-a@example.com'})).json();assert.equal(me.signedIn,true);
 assert.equal((await (await h.call('devices',{owner:'owner-b',email:'owner-a@example.com'})).json()).devices.length,0);
 assert.equal((await h.call('devices/'+d.id+'/invite',{method:'POST',owner:'owner-b',data:{}})).status,404);
 assert.equal(h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(d.id).owner,'legacy-owner');
});

test('a confirmed legacy key claim revokes old access, keeps the connector key and moves only one device',async()=>{
 const h=harness(),d=await register(h),sibling=await register(h,'Other Mac');await online(h,d);
 const i=await persistent(h,d),s=await join(h,i);await active(h,d,s);

 h.sqlite.prepare('INSERT OR REPLACE INTO invite_verifications (invite,failures,window) VALUES (?,1,?)').run(i.code.split('.')[0],Date.now());
 await legacyDevice(h,d);await legacyDevice(h,sibling);
 h.sqlite.prepare('INSERT INTO turn_settings (owner,sealed,updated) VALUES (?,?,?)').run('legacy-owner','private legacy settings',Date.now());
 const result=await claim(h,d);assert.equal(result.status,200);const body=await result.json();assert.equal(body.alreadyOwned,false);assert.equal(JSON.stringify(body).includes(d.token),false);
 assert.equal(h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(d.id).owner,'google:owner-b');
 assert.equal(h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(sibling.id).owner,'legacy-owner');
 assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'ended');
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM invites WHERE device=?').get(d.id).n,0);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM invite_verifications').get().n,0);

 assert.equal(h.sqlite.prepare('SELECT owner FROM turn_settings').get().owner,'legacy-owner');

 assert.equal((await h.call('join',{method:'POST',data:{code:i.code,hostEmail:'owner-a@example.com',offer:'v=0'}})).status,410);
 await online(h,d);
 assert.equal((await (await h.call('devices',{owner:'owner-b'})).json()).devices.length,1);
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

test('a claimed Google device cannot be taken by another Google subject and retries do not revoke new access',async()=>{
 const h=harness(),d=await register(h);await legacyDevice(h,d);assert.equal((await claim(h,d,'owner-a')).status,200);
 await online(h,d);const i=await persistent(h,d),s=await join(h,i);await active(h,d,s);
 assert.equal((await claim(h,d,'owner-b')).status,409);
 const again=await claim(h,d,'owner-a');assert.equal(again.status,200);assert.equal((await again.json()).alreadyOwned,true);
 assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'active');

 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM invites').get().n,1);
});

test('racing legacy key claims have one winner and the losing claim cannot revoke new owner access',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await persistent(h,d),s=await join(h,i);await active(h,d,s);await legacyDevice(h,d);
 const responses=await Promise.all([claim(h,d,'owner-b'),claim(h,d,'owner-c')]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const owner=h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(d.id).owner;
 assert.ok(['google:owner-b','google:owner-c'].includes(owner));
 const winner=owner.slice(7),loser=winner==='owner-b'?'owner-c':'owner-b';
 const fresh=await h.call('devices/'+d.id+'/invite',{method:'POST',owner:winner,data:{reusable:true}});assert.equal(fresh.status,200);
 const freshId=(await fresh.json()).code.split('.')[0];assert.equal((await claim(h,d,loser)).status,409);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM invites WHERE id=?').get(freshId).n,1);
});

test('a full target account cannot revoke legacy access while a claim fails its device limit',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const i=await persistent(h,d),s=await join(h,i);await active(h,d,s);await legacyDevice(h,d);
 for(let n=0;n<8;n++)assert.equal((await h.call('devices',{method:'POST',owner:'owner-b',data:{name:'Mac '+n}})).status,201);
 assert.equal((await claim(h,d)).status,409);
 assert.equal(h.sqlite.prepare('SELECT status FROM sessions WHERE id=?').get(s.id).status,'active');
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM invites WHERE device=?').get(d.id).n,1);
 assert.equal(h.sqlite.prepare('SELECT owner FROM devices WHERE id=?').get(d.id).owner,'legacy-owner');
});

// Removed paths stay unavailable even to otherwise authorized active sessions.
test('removed HTTPS media and input routes return 404 and status contains no payload queue',async()=>{
 const h=harness(),d=await register(h);await online(h,d);const s=await join(h,await persistent(h,d));await active(h,d,s);
 for(const action of ['relay','input','frame'])for(const method of ['GET','POST'])assert.equal((await h.call('sessions/'+s.id+'/'+action,{method,token:s.token,...(method==='POST'?{data:{events:[{type:'text',text:'never stored'}]}}:{})})).status,404);
 const upload=await handleApi(new Request('https://maclink.example/api/agent/'+d.id+'/frame',{method:'POST',headers:{Authorization:'Bearer '+d.token,'Content-Type':'image/jpeg'},body:new Uint8Array([255,216,255,217])}),h.env);assert.equal(upload.status,404);
 const poll=await (await h.call('agent/'+d.id+'/poll',{method:'POST',token:d.token,data:{}})).json();assert.equal(poll.session.status,'active');assert.equal('events' in poll,false);assert.equal('frameStatus' in poll,false);assert.equal('transport' in poll.session,false);
 assert.equal(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='inputs'").get(),undefined);
 assert.equal(h.sqlite.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='transport'),false);
});
