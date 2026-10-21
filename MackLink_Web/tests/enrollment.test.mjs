import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {handleApi} from '../lib/server.ts';
import {handleGoogleAuth} from '../lib/google-auth.ts';

const ORIGIN='https://maclink.example',sha=value=>createHash('sha256').update(value).digest('hex');
function harness(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 function prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(query).get(...args)||null;},async all(){return {results:sqlite.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(query).run(...args).changes)}};}};}
 let queue=Promise.resolve();const cookies=new Map();
 const env={AUTH_BASE_URL:ORIGIN,DB:{prepare,async batch(statements){const pending=queue.then(async()=>{sqlite.exec('BEGIN');try{const values=[];for(const statement of statements)values.push(await statement.run());sqlite.exec('COMMIT');return values;}catch(error){sqlite.exec('ROLLBACK');throw error;}});queue=pending.catch(()=>{});return pending;}}};
 function freshCookie(owner='a'){
  const now=Date.now(),token=randomBytes(32).toString('base64url'),id='google:'+owner;
  sqlite.prepare('INSERT INTO auth_users (id,google_sub,email,name,created,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id,owner,owner+'@example.com',null,now,now);
  sqlite.prepare('INSERT INTO auth_sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)').run(sha(token),id,now,now+7*86400000);
  return '__Host-maclink_session='+token;
 }
 function cookie(owner='a'){if(!cookies.has(owner))cookies.set(owner,freshCookie(owner));return cookies.get(owner);}
 async function call(path,{method='GET',data,owner,proof,headers={},raw,url=ORIGIN+'/api/'+path}={}){
  const h={...(owner&&method!=='GET'?{Origin:ORIGIN}:{}),...(owner?{Cookie:cookie(owner)}:{}),...(proof?{Authorization:'Bearer '+proof}:{}),...headers};
  let body=raw;if(data!==undefined){body=JSON.stringify(data);h['Content-Type']='application/json';}
  return handleApi(new Request(url,{method,headers:h,body}),env);
 }
 async function logout(value){return handleGoogleAuth(new Request(ORIGIN+'/auth/signout',{method:'POST',headers:{Origin:ORIGIN,Cookie:value}}),env);}
 return {sqlite,env,cookie,freshCookie,call,logout};
}
function attempt(){const requestId=randomBytes(12).toString('hex'),proof=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex');return {requestId,proof,token,data:{requestId,name:'My Mac',credentialHash:sha(token)}};}
async function start(h,a=attempt(),options={}){const response=await h.call('enrollment/start',{method:'POST',proof:a.proof,data:a.data,...options});assert.ok(response.ok,await response.clone().text());return {...a,start:await response.json()};}
const approve=(h,a,owner='a',extra={})=>h.call('enrollment/'+a.requestId+'/approve',{method:'POST',owner,data:{verificationCode:a.start.verificationCode,expectedOwnerId:'google:'+owner},...extra});
const poll=(h,a,extra={})=>h.call('enrollment/'+a.requestId+'/poll',{method:'POST',proof:a.proof,...extra});
const cancel=(h,a,extra={})=>h.call('enrollment/'+a.requestId+'/cancel',{method:'POST',proof:a.proof,...extra});
async function listed(h,owner='a'){return (await (await h.call('devices',{owner})).json()).devices;}

// Enrollment capabilities are independent: the public request id never approves
// a device or retrieves its registration credential.
test('native start returns only a bounded public URL and keeps both native secrets out of storage',async()=>{
 const h=harness(),a=await start(h,attempt(),{headers:{'CF-Connecting-IP':'203.0.113.9'}}),result=a.start;
 assert.equal(result.id,a.requestId);assert.equal(result.status,'pending');assert.match(result.verificationCode,/^\d{6}$/);assert.equal(result.pollInterval,4);assert.equal(result.verificationUrl,ORIGIN+'/connect-mac?request='+a.requestId);assert.ok(result.expiresAt>Date.now()+599000&&result.expiresAt<=Date.now()+600000);
 const row=h.sqlite.prepare('SELECT * FROM enrollments').get();assert.equal(row.credential_hash,sha(a.token));assert.equal(row.claim_hash,sha('enrollment-claim:'+a.proof));assert.equal(row.owner,null);assert.match(row.device,/^[a-f0-9]{24}$/);assert.equal(row.failures,0);
 const stored=JSON.stringify(h.sqlite.prepare('SELECT * FROM enrollments').all())+JSON.stringify(h.sqlite.prepare('SELECT * FROM enrollment_limits').all());for(const secret of [a.proof,a.token,'203.0.113.9'])assert.equal(stored.includes(secret),false);
 for(const secret of [a.proof,a.token,a.data.credentialHash])assert.equal(JSON.stringify(result).includes(secret),false);
 assert.equal((await listed(h)).length,0);
});

test('start is idempotent even for parallel retries and conflicting proofs never overwrite a request',async()=>{
 const h=harness(),a=attempt();
 const replies=await Promise.all(Array.from({length:20},()=>h.call('enrollment/start',{method:'POST',proof:a.proof,data:a.data})));assert.equal(replies.every(r=>r.ok),true);
 const states=await Promise.all(replies.map(r=>r.json()));assert.equal(new Set(states.map(r=>r.verificationCode)).size,1);assert.equal(new Set(states.map(r=>r.expiresAt)).size,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM enrollments').get().n,1);assert.equal(h.sqlite.prepare('SELECT requests FROM enrollment_limits').get().requests,1);
 assert.equal((await h.call('enrollment/start',{method:'POST',proof:'f'.repeat(64),data:a.data})).status,409);
 assert.equal((await h.call('enrollment/start',{method:'POST',proof:a.proof,data:{...a.data,credentialHash:'f'.repeat(64)}})).status,409);
 const retry=await (await h.call('enrollment/start',{method:'POST',proof:a.proof,data:{...a.data,name:'Changed'}})).json();assert.equal(retry.name,'My Mac');
});

test('new requests have an atomic per-IP budget and duplicate retries do not consume it',async t=>{
 const h=harness();let now=Date.now();t.mock.method(Date,'now',()=>now);const attempts=[];
 const results=await Promise.all(Array.from({length:24},()=>{const a=attempt();attempts.push(a);return h.call('enrollment/start',{method:'POST',proof:a.proof,data:a.data,headers:{'CF-Connecting-IP':'203.0.113.1'}});}));
 assert.equal(results.filter(r=>r.ok).length,10);assert.equal(results.filter(r=>r.status===429).length,14);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM enrollments').get().n,10);
 const winner=attempts[results.findIndex(r=>r.ok)];assert.equal((await h.call('enrollment/start',{method:'POST',proof:winner.proof,data:winner.data,headers:{'CF-Connecting-IP':'203.0.113.1'}})).status,200);
 await start(h,attempt(),{headers:{'CF-Connecting-IP':'203.0.113.2'}});
 now+=600001;await start(h,attempt(),{headers:{'CF-Connecting-IP':'203.0.113.1'}});assert.equal(h.sqlite.prepare('SELECT requests FROM enrollment_limits WHERE bucket=?').get(sha('enrollment-ip:203.0.113.1')).requests,1);
});

test('native routes reject absent proofs, malformed data, streaming oversized JSON and unsafe origins',async()=>{
 const h=harness(),a=attempt();assert.equal((await h.call('enrollment/start',{method:'POST',data:a.data})).status,401);
 for(const data of [null,[],{}, {...a.data,requestId:'bad'},{...a.data,credentialHash:'bad'},{...a.data,name:' '},{...a.data,name:'x'.repeat(61)},{...a.data,name:'Mac\nname'}])assert.equal((await h.call('enrollment/start',{method:'POST',proof:a.proof,data})).status,400);
 for(const headers of [{Origin:'https://attacker.example'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await h.call('enrollment/start',{method:'POST',proof:a.proof,data:a.data,headers})).status,403);
 assert.equal((await h.call('enrollment/start',{method:'POST',proof:a.proof,raw:JSON.stringify(a.data),headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await h.call('enrollment/start',{method:'POST',proof:a.proof,data:{...a.data,extra:'x'.repeat(9000)}})).status,413);
 const bytes=new TextEncoder().encode(JSON.stringify({...a.data,extra:'x'.repeat(9000)}));let at=0;
 const body=new ReadableStream({pull(controller){if(at>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(at,at+1000));at+=1000;}});
 const streamed=await handleApi(new Request(ORIGIN+'/api/enrollment/start',{method:'POST',duplex:'half',headers:{Authorization:'Bearer '+a.proof,'Content-Type':'application/json'},body}),h.env);assert.equal(streamed.status,413);
 assert.equal((await h.call('enrollment/start',{method:'POST',proof:a.proof,data:a.data,url:'https://attacker.example/api/enrollment/start'})).status,403);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM enrollments').get().n,0);
});

test('the browser must sign in and a public request URL never reveals the code or native proofs',async()=>{
 const h=harness(),a=await start(h);
 assert.equal((await h.call('enrollment/'+a.requestId)).status,401);assert.equal((await h.call('enrollment/'+a.requestId,{headers:{'oai-authenticated-user-id':'google:a','x-google-user-id':'google:a'}})).status,401);
 const r=await h.call('enrollment/'+a.requestId,{owner:'a'});assert.equal(r.status,200);const result=await r.json();assert.deepEqual(Object.keys(result).sort(),['expiresAt','id','name','status']);
 for(const secret of [a.start.verificationCode,a.proof,a.token,a.data.credentialHash,'claim_hash','credential_hash','deviceId'])assert.equal(JSON.stringify(result).includes(secret),false);
 assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');
 assert.equal((await h.call('enrollment/'+a.requestId+'/approve',{method:'POST',owner:'a',data:{expectedOwnerId:'google:a'}})).status,400);assert.equal((await listed(h)).length,0);
});

test('approval requires the real native code, current Google cookie and same-origin CSRF protection',async()=>{
 const h=harness(),a=await start(h);
 assert.equal((await approve(h,a,null)).status,401);
 for(const origin of [undefined,'null','https://attacker.example']){
  const headers={Cookie:h.cookie(),...(origin?{Origin:origin}:{})};const result=await h.call('enrollment/'+a.requestId+'/approve',{method:'POST',data:{verificationCode:a.start.verificationCode},headers});assert.equal(result.status,403);
 }
 assert.equal((await approve(h,a,'a',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await approve(h,a)).status,200);const devices=await listed(h);assert.equal(devices.length,1);assert.equal(devices[0].setupState,'awaiting-connector');assert.equal(devices[0].seen,0);assert.equal(devices[0].online,false);
 const row=h.sqlite.prepare('SELECT * FROM devices').get();assert.equal(row.owner,'google:a');assert.equal(row.agent_hash,sha(a.token));assert.notEqual(row.agent_hash,a.token);
 const state=await (await h.call('enrollment/'+a.requestId,{owner:'a'})).json();assert.equal(state.status,'approved');assert.equal(state.deviceId,row.id);assert.equal('verificationCode' in state,false);
 const result=await (await poll(h,a)).json();assert.deepEqual(result.config,{site:ORIGIN,device:row.id,name:'My Mac'});assert.equal(JSON.stringify(result).includes(a.token),false);
 assert.equal((await h.call('agent/'+row.id+'/poll',{method:'POST',proof:a.token,headers:{Authorization:'Bearer '+a.token},data:{info:{version:'1.3.2'}}})).status,200);
 const online=(await listed(h))[0];assert.equal(online.online,true);assert.equal(online.setupState,'online');
});

test('wrong codes share a five-attempt atomic budget across Google accounts and terminate the request',async()=>{
 const h=harness(),a=await start(h),wrong=a.start.verificationCode==='000000'?'111111':'000000';
 const results=await Promise.all(Array.from({length:16},(_,index)=>approve(h,a,'attacker-'+index,{data:{verificationCode:wrong,expectedOwnerId:'google:'+'attacker-'+index}})));
 assert.ok(results.filter(r=>r.status===400).length<=4);assert.ok(results.filter(r=>r.status===429).length>=12);assert.equal(results.every(r=>r.status===400||r.status===429),true);
 const row=h.sqlite.prepare('SELECT failures,status FROM enrollments').get();assert.equal(row.failures,5);assert.equal(row.status,'cancelled');assert.equal((await listed(h)).length,0);
 assert.equal((await approve(h,a)).status,429);assert.equal((await (await poll(h,a)).json()).status,'cancelled');
 for(const response of results){const value=await response.text();assert.equal(value.includes(a.start.verificationCode),false);assert.equal(value.includes(a.proof),false);}
});

test('a correct approval racing the final failed guess either wins once or stays cancelled',async()=>{
 const h=harness(),a=await start(h),wrong=a.start.verificationCode==='000000'?'111111':'000000';
 h.sqlite.prepare('UPDATE enrollments SET failures=4 WHERE id=?').run(a.requestId);
 const results=await Promise.all([approve(h,a,'a'),approve(h,a,'b',{data:{verificationCode:wrong,expectedOwnerId:'google:b'}})]);
 const row=h.sqlite.prepare('SELECT * FROM enrollments').get();
 if(row.status==='approved'){assert.equal(row.owner,'google:a');assert.equal((await listed(h)).length,1);assert.equal(results[0].status,200);assert.equal(results[1].status,404);}else{assert.equal(row.status,'cancelled');assert.equal(row.failures,5);assert.equal((await listed(h)).length,0);assert.equal(results[0].status,429);}
});

test('repeated and competing approvals create only one device and never switch its Google owner',async()=>{
 const h=harness(),a=await start(h);
 const results=await Promise.all(Array.from({length:12},(_,index)=>approve(h,a,index%2?'b':'a')));
 const row=h.sqlite.prepare('SELECT * FROM enrollments').get();assert.equal(row.status,'approved');const winner=row.owner.slice(7),loser=winner==='a'?'b':'a';
 assert.equal(results.filter(r=>r.ok).length,6);assert.equal(results.filter(r=>r.status===404).length,6);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM devices').get().n,1);
 const retry=await approve(h,a,winner);assert.equal(retry.status,200);assert.equal((await retry.json()).deviceId,row.device);
 const fresh=await h.call('enrollment/'+a.requestId,{headers:{Cookie:h.freshCookie(winner)}});assert.equal(fresh.status,200);assert.equal((await fresh.json()).deviceId,row.device);
 assert.equal((await h.call('enrollment/'+a.requestId,{owner:loser})).status,404);assert.equal((await approve(h,a,loser)).status,404);assert.equal((await approve(h,a,winner,{data:{verificationCode:'not-a-code',expectedOwnerId:'google:'+winner}})).status,400);
});

test('approval respects the eight-device limit even while requests race',async()=>{
 const h=harness();for(let index=0;index<7;index++)assert.equal((await h.call('devices',{method:'POST',owner:'a',data:{name:'Mac '+index}})).status,201);
 const a=await start(h),b=await start(h);const results=await Promise.all([approve(h,a),approve(h,b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await listed(h)).length,8);
 const loser=results[0].ok?b:a;assert.equal(h.sqlite.prepare('SELECT status,owner FROM enrollments WHERE id=?').get(loser.requestId).status,'pending');assert.equal(h.sqlite.prepare('SELECT owner FROM enrollments WHERE id=?').get(loser.requestId).owner,null);
});

test('logout or expiration before the approval mutation cannot register a device',async()=>{
 for(const mode of ['logout','expire']){
  const h=harness(),a=await start(h),cookie=h.cookie(),batch=h.env.DB.batch;let once=true;
  h.env.DB.batch=async statements=>{if(once&&statements.length===2){once=false;if(mode==='logout')await h.logout(cookie);else h.sqlite.prepare('UPDATE auth_sessions SET expires=?').run(Date.now()-1);}return batch(statements);};
  assert.equal((await approve(h,a)).status,401);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM devices').get().n,0);const row=h.sqlite.prepare('SELECT status,owner FROM enrollments').get();assert.equal(row.status,'pending');assert.equal(row.owner,null);
 }
});

test('native cancellation is idempotent and approval/cancellation races have one unambiguous result',async()=>{
 const h=harness(),a=await start(h);assert.equal((await cancel(h,a)).status,200);assert.equal((await (await cancel(h,a)).json()).status,'cancelled');assert.equal((await approve(h,a)).status,409);assert.equal((await listed(h)).length,0);
 const b=await start(h),results=await Promise.all([approve(h,b),cancel(h,b)]),state=await (await poll(h,b)).json();
 assert.equal(state.status,'cancelled');assert.ok(results[0].status===200||results[0].status===409);assert.equal(results[1].status,200);assert.equal((await listed(h)).length,0);
});

test('poll and cancel require the original native proof and never return a credential token',async()=>{
 const h=harness(),a=await start(h);
 for(const action of ['poll','cancel']){assert.equal((await h.call('enrollment/'+a.requestId+'/'+action,{method:'POST'})).status,401);assert.equal((await h.call('enrollment/'+a.requestId+'/'+action,{method:'POST',proof:'f'.repeat(64)})).status,404);}
 const pending=await (await poll(h,a)).json();assert.equal(pending.status,'pending');assert.equal('config' in pending,false);assert.equal('verificationCode' in pending,false);
 await approve(h,a);const granted=await (await poll(h,a)).json();assert.equal(granted.status,'approved');assert.deepEqual(Object.keys(granted.config).sort(),['device','name','site']);for(const secret of [a.token,a.proof,a.start.verificationCode])assert.equal(JSON.stringify(granted).includes(secret),false);
 const cancelled=await cancel(h,a);assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).status,'cancelled');assert.equal((await listed(h)).length,0);
});

test('pending approval expires after ten minutes while approved delivery stays idempotent for twenty-four hours',async t=>{
 const h=harness();let now=Date.now();t.mock.method(Date,'now',()=>now);const approved=await start(h),pending=await start(h);await approve(h,approved);
 now+=600001;assert.equal((await (await poll(h,pending)).json()).status,'expired');assert.equal((await approve(h,pending)).status,410);assert.equal((await (await poll(h,approved)).json()).status,'approved');assert.equal((await (await h.call('enrollment/'+approved.requestId,{owner:'a'})).json()).status,'approved');
 const retried=await start(h,{...pending,data:pending.data});assert.equal(retried.start.status,'expired');assert.equal(retried.start.expiresAt,pending.start.expiresAt);
 now+=24*3600000;assert.equal((await (await poll(h,approved)).json()).status,'expired');await start(h,attempt());assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM enrollments WHERE id IN (?,?)').get(approved.requestId,pending.requestId).n,0);
});

test('a removed, disabled or reassigned approved device cannot be resurrected from an old native request',async()=>{
 for(const action of ['remove','disable','reassign']){
  const h=harness(),a=await start(h);await approve(h,a);const row=h.sqlite.prepare('SELECT * FROM enrollments').get();
  if(action==='remove')h.sqlite.prepare('DELETE FROM devices WHERE id=?').run(row.device);if(action==='disable')h.sqlite.prepare('UPDATE devices SET enabled=0 WHERE id=?').run(row.device);if(action==='reassign')h.sqlite.prepare('UPDATE devices SET owner=? WHERE id=?').run('google:b',row.device);
  const result=await (await poll(h,a)).json();assert.equal(result.status,'cancelled');assert.equal('config' in result,false);assert.equal((await approve(h,a)).status,409);
 }
});

test('the enrollment migration preserves existing accounts, keys and sessions while removing restored invitations',()=>{
 const sqlite=new DatabaseSync(':memory:');const files=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();for(const file of files.filter(f=>f<'0009_'))sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 sqlite.prepare('INSERT INTO devices (id,owner,name,agent_hash,created,seen,enabled,info) VALUES (?,?,?,?,1,1,1,?)').run('existing','google:a','Current Mac','existing-hash','{}');
 sqlite.prepare('INSERT INTO invites (id,device,secret_hash,mode,expires,used,reusable) VALUES (?,?,?,?,0,0,1)').run('legacy','existing','old-secret-hash','control');
 sqlite.prepare('INSERT INTO sessions (id,device,invite,owner,auth_session_hash,guest_hash,guest_name,mode,status,offer,created,expires,seen) VALUES (?,?,?,?,?,?,?,?,?,?,1,0,1)').run('existing-session','existing','legacy','google:a','existing-login-hash','viewer','Device owner','control','active','v=0');
 const migration=readFileSync(new URL('../drizzle/0009_connector_enrollment.sql',import.meta.url),'utf8');assert.equal(/\b(?:UPDATE|DELETE|INSERT)\b/i.test(migration),false);sqlite.exec(migration);
 assert.equal(sqlite.prepare('SELECT agent_hash FROM devices').get().agent_hash,'existing-hash');assert.equal(sqlite.prepare('SELECT status,owner,auth_session_hash FROM sessions').get().status,'active');assert.equal(sqlite.prepare('SELECT owner FROM sessions').get().owner,'google:a');assert.equal(sqlite.prepare('PRAGMA table_info(sessions)').all().some(column=>column.name==='invite'),false);
 for(const table of ['invites','invite_verifications','owner_identities'])assert.equal(sqlite.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table),undefined);
 for(const table of ['enrollments','enrollment_limits'])assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
});

test('storage failures fail closed and expose no body, native token or exception details',async()=>{
 const h=harness(),a=attempt(),log=console.error;let logged=[];console.error=(...values)=>logged.push(values.join(' '));
 try{h.env.DB.prepare=()=>{throw new Error(a.proof+' private database detail');};const response=await h.call('enrollment/start',{method:'POST',proof:a.proof,data:a.data});assert.equal(response.status,503);assert.equal((await response.text()).includes(a.proof),false);assert.equal(logged.some(value=>value.includes(a.proof)||value.includes('database detail')),false);}finally{console.error=log;}
});


test('approval rechecks expiration after reading the browser body instead of retaining the request-start clock',async t=>{
 const h=harness();let now=Date.now();t.mock.method(Date,'now',()=>now);const a=await start(h),prepare=h.env.DB.prepare;let delayed=true;
 h.env.DB.prepare=query=>{const statement=prepare(query),first=statement.first;statement.first=async()=>{const value=await first();if(delayed&&query==='SELECT * FROM enrollments WHERE id=?'){delayed=false;now+=600001;}return value;};return statement;};
 assert.equal((await approve(h,a)).status,410);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM devices').get().n,0);assert.equal(h.sqlite.prepare('SELECT status FROM enrollments').get().status,'pending');
});


test('a delayed approval retry cannot recreate a device removed after another request won approval',async()=>{
 const h=harness(),a=await start(h),batch=h.env.DB.batch;let delayed=true;
 h.env.DB.batch=async statements=>{if(delayed&&statements.length===2){delayed=false;const winner=await approve(h,a);assert.equal(winner.status,200);const result=await winner.json();h.sqlite.prepare('DELETE FROM devices WHERE id=?').run(result.deviceId);}return batch(statements);};
 const result=await approve(h,a);assert.equal(result.status,409);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM devices').get().n,0);assert.equal((await (await poll(h,a)).json()).status,'cancelled');
});

test('advanced manual registration and browser approval share the same atomic device quota',async()=>{
 const h=harness();for(let index=0;index<7;index++)await h.call('devices',{method:'POST',owner:'a',data:{name:'Existing '+index}});const a=await start(h);
 const results=await Promise.all([approve(h,a),h.call('devices',{method:'POST',owner:'a',data:{name:'Manual'}})]);assert.equal(results.filter(response=>response.ok).length,1);assert.equal(results.filter(response=>response.status===409).length,1);assert.equal((await listed(h)).length,8);
});

test('the displayed owner must match the live Google account at approval, even after another-tab login changes it',async()=>{
 const h=harness(),a=await start(h);
 assert.equal((await approve(h,a,'b',{data:{verificationCode:a.start.verificationCode,expectedOwnerId:'google:a'}})).status,409);
 assert.equal((await approve(h,a,'a',{data:{verificationCode:a.start.verificationCode}})).status,400);
 assert.equal((await listed(h,'a')).length,0);assert.equal((await listed(h,'b')).length,0);assert.equal(h.sqlite.prepare('SELECT failures FROM enrollments').get().failures,0);
 assert.equal((await approve(h,a)).status,200);assert.equal(h.sqlite.prepare('SELECT owner FROM devices').get().owner,'google:a');
});

test('native cancellation can retract only its exact unseen new registration and leaves every other key intact',async()=>{
 const h=harness(),a=await start(h);await approve(h,a);const enrollment=h.sqlite.prepare('SELECT * FROM enrollments').get();
 const other=await (await h.call('devices',{method:'POST',owner:'a',data:{name:'Existing Mac'}})).json();
 assert.equal((await cancel(h,a,{proof:'f'.repeat(64)})).status,404);assert.equal((await listed(h)).length,2);
 const response=await cancel(h,a);assert.equal(response.status,200);assert.equal((await response.json()).status,'cancelled');assert.deepEqual((await listed(h)).map(device=>device.id),[other.id]);
 assert.equal((await h.call('agent/'+enrollment.device+'/poll',{method:'POST',proof:a.token,data:{info:{}}})).status,401);
 assert.equal((await h.call('agent/'+other.id+'/check',{proof:other.token})).status,200);assert.equal((await (await poll(h,a)).json()).status,'cancelled');
});

test('a committed first heartbeat wins cancellation and a used registration is never deleted',async()=>{
 const h=harness(),a=await start(h);await approve(h,a);const enrollment=h.sqlite.prepare('SELECT * FROM enrollments').get(),batch=h.env.DB.batch;let firstHeartbeat=true;
 h.env.DB.batch=async statements=>{if(firstHeartbeat&&statements.length===2){firstHeartbeat=false;assert.equal((await h.call('agent/'+enrollment.device+'/poll',{method:'POST',proof:a.token,data:{info:{screen:true}}})).status,200);}return batch(statements);};
 const response=await cancel(h,a);assert.equal(response.status,409);assert.equal((await response.json()).status,'approved');assert.equal((await listed(h)).length,1);assert.equal((await listed(h))[0].online,true);assert.equal(h.sqlite.prepare('SELECT status FROM enrollments').get().status,'approved');
 assert.equal((await (await poll(h,a)).json()).status,'approved');
});
