import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {getGoogleUser,getGoogleSession,handleGoogleAuth} from '../lib/google-auth.ts';

const ORIGIN='https://www.maclink.example';
const CLIENT='maclink-test.apps.googleusercontent.com';
const COOKIE='__Host-maclink_session',BROWSER='__Host-maclink_oauth';
const signing=crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const base64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
async function sha(value){return Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');}
function harness(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 function prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};}
 const env={AUTH_BASE_URL:ORIGIN,GOOGLE_CLIENT_ID:CLIENT,GOOGLE_CLIENT_SECRET:'synthetic-test-secret',DB:{prepare,async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}}};
 const req=(path,options={})=>new Request(ORIGIN+path,options);
 return {sqlite,env,req,call:(path,options)=>handleGoogleAuth(req(path,options),env)};
}
async function remoteSession(h,cookie,id='synthetic-remote'){
 const now=Date.now(),owner='google:test-google-subject',device='synthetic-device-'+id;
 h.sqlite.prepare('INSERT INTO devices (id,owner,name,agent_hash,created,seen,enabled,info) VALUES (?,?,?,?,?,?,1,?)').run(device,owner,'Test Mac','synthetic-agent-hash',now,now,'{}');
 h.sqlite.prepare('INSERT INTO sessions (id,device,owner,auth_session_hash,guest_hash,guest_name,mode,status,offer,answer,created,expires,seen,generation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)').run(id,device,owner,await sha(cookie.split('=')[1]),'synthetic-viewer-hash','Device owner','control','active','v=0 offer','v=0 answer',now,0,now);
 return id;
}

function cookies(response){return response.headers.getSetCookie().map(value=>value.split(';')[0]);}
async function begin(h,returnPath='/hosts?from=google'){
 const response=await h.call('/auth/google?return_to='+encodeURIComponent(returnPath));assert.equal(response.status,303);
 const url=new URL(response.headers.get('location'));
 return {response,url,browser:cookies(response)[0],state:url.searchParams.get('state'),transaction:h.sqlite.prepare('SELECT * FROM auth_transactions').get()};
}
function callback(h,login,extra={}){const url=new URL(ORIGIN+'/auth/google/callback');url.searchParams.set('state',login.state);url.searchParams.set('code','synthetic-code');for(const [key,value]of Object.entries(extra))url.searchParams.set(key,value);return new Request(url,{headers:{cookie:login.browser}});}
async function provider(t,login,{claims={},badSignature=false,tokenError=false}={}){
 const keys=await signing;
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'maclink-synthetic-rsa',alg:'RS256',use:'sig'};
 const calls=[];
 t.mock.method(globalThis,'fetch',async(input,options={})=>{
  const url=String(input);calls.push(url);
  if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
  assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(options.method,'POST');
  const params=new URLSearchParams(options.body);
  assert.equal(params.get('client_id'),CLIENT);assert.equal(params.get('client_secret'),'synthetic-test-secret');
  assert.equal(params.get('code'),'synthetic-code');assert.equal(params.get('redirect_uri'),ORIGIN+'/auth/google/callback');
  assert.equal(params.get('code_verifier'),login.transaction.verifier);
  assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(params.get('code_verifier')))).toString('base64url'),login.url.searchParams.get('code_challenge'));
  if(tokenError)return Response.json({error:'invalid_grant',error_description:'sensitive provider error synthetic-code'},{status:400});
  const now=Math.floor(Date.now()/1000);
  const payload={iss:'https://accounts.google.com',aud:CLIENT,sub:'test-google-subject',iat:now,exp:now+3600,nonce:login.transaction.nonce,email:'MacLink.User@example.com',email_verified:true,name:'MacLink User',...claims};
  const content=base64({alg:'RS256',kid:jwk.kid})+'.'+base64(payload);
  const key=badSignature?(await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])).privateKey:keys.privateKey;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(content));
  return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:3600,id_token:content+'.'+Buffer.from(signature).toString('base64url')});
 });
 return calls;
}

test('Google authorization uses fresh state, nonce, PKCE and a browser-bound short-lived transaction',async()=>{
 const h=harness(),one=await begin(h),two=await begin(h);
 assert.equal(one.url.origin,'https://accounts.google.com');assert.equal(one.url.pathname,'/o/oauth2/v2/auth');
 assert.equal(one.url.searchParams.get('scope'),'openid email profile');assert.equal(one.url.searchParams.get('response_type'),'code');
 assert.equal(one.url.searchParams.get('code_challenge_method'),'S256');assert.equal(one.url.searchParams.get('redirect_uri'),ORIGIN+'/auth/google/callback');
 assert.notEqual(one.state,two.state);assert.notEqual(one.url.searchParams.get('nonce'),two.url.searchParams.get('nonce'));
 assert.equal(one.transaction.state_hash,await sha(one.state));assert.equal(one.transaction.browser_hash,await sha(one.browser.split('=')[1]));
 assert.ok(one.transaction.expires>Date.now()&&one.transaction.expires<=Date.now()+600_000);
 assert.match(one.response.headers.get('set-cookie'),/__Host-maclink_oauth=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
 assert.equal(one.response.headers.get('cache-control'),'no-store');assert.equal(one.response.headers.get('referrer-policy'),'no-referrer');
 assert.equal(one.url.searchParams.has('access_type'),false);assert.equal(one.url.searchParams.has('client_secret'),false);
});

test('a signed synthetic Google response creates an opaque revocable session keyed by sub',async t=>{
 const h=harness(),login=await begin(h);const calls=await provider(t,login);
 const response=await handleGoogleAuth(callback(h,login),h.env);assert.equal(response.status,303);assert.equal(response.headers.get('location'),ORIGIN+'/hosts?from=google');
 assert.equal(calls.filter(url=>url.endsWith('/token')).length,1);
 const sessionCookie=cookies(response).find(value=>value.startsWith(COOKIE+'='));assert.ok(sessionCookie);
 assert.match(response.headers.getSetCookie().find(value=>value.startsWith(COOKIE+'=')),/Max-Age=604800; Secure$/);
 const token=sessionCookie.split('=')[1];assert.equal(token.length,43);
 const row=h.sqlite.prepare('SELECT * FROM auth_sessions').get();assert.equal(row.token_hash,await sha(token));assert.notEqual(row.token_hash,token);assert.equal(row.user_id,'google:test-google-subject');
 const user=await getGoogleUser(h.req('/api/devices',{headers:{cookie:sessionCookie}}),h.env);
 assert.deepEqual(user,{userId:'google:test-google-subject',email:'maclink.user@example.com',fullName:'MacLink User',displayName:'MacLink User'});
 const browser=await getGoogleSession(h.req('/api/devices',{headers:{cookie:sessionCookie}}),h.env);assert.deepEqual(browser,{...user,sessionHash:row.token_hash});assert.equal('sessionHash' in user,false);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_transactions').get().n,0);
 const serialized=JSON.stringify(h.sqlite.prepare('SELECT * FROM auth_users').get())+JSON.stringify(row);
 assert.equal(serialized.includes('synthetic-access-token'),false);assert.equal(serialized.includes('synthetic-test-secret'),false);
 const replay=await handleGoogleAuth(callback(h,login),h.env);assert.equal(replay.status,400);assert.equal(calls.filter(url=>url.endsWith('/token')).length,1);
 const withoutCredentials={DB:h.env.DB,AUTH_BASE_URL:ORIGIN};assert.equal((await getGoogleUser(h.req('/api/me',{headers:{cookie:sessionCookie}}),withoutCredentials)).userId,user.userId);
});

test('callbacks reject an absent, mismatched or duplicate browser cookie, duplicate query fields and expired state without contacting Google',async t=>{
 for(const attack of ['missing','wrong','duplicate','query','expired','state'])await t.test(attack,async()=>{
  const h=harness(),login=await begin(h);let req=callback(h,login);const headers=new Headers(req.headers);let url=new URL(req.url);
  if(attack==='missing')headers.delete('cookie');
  if(attack==='wrong')headers.set('cookie',BROWSER+'='+'x'.repeat(43));
  if(attack==='duplicate')headers.set('cookie',login.browser+'; '+login.browser);
  if(attack==='query')url.searchParams.append('code','another-code');
  if(attack==='expired')h.sqlite.prepare('UPDATE auth_transactions SET expires=?').run(Date.now()-1);
  if(attack==='state')url.searchParams.set('state','y'.repeat(43));
  t.mock.method(globalThis,'fetch',async()=>assert.fail('invalid callbacks must not contact provider'));
  assert.equal((await handleGoogleAuth(new Request(url,{headers}),h.env)).status,400);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);t.mock.restoreAll();
 });
});

test('ID tokens fail closed for invalid issuer, audience, nonce, expiration, signature or unverified email',async t=>{
 const invalid=[['issuer',{iss:'https://attacker.example'}],['audience',{aud:'other-client'}],['nonce',{nonce:'wrong-nonce'}],['expiry',{exp:1}],['signature',{},true],['unverified',{email_verified:false}],['string-verification',{email_verified:'true'}],['missing-sub',{sub:undefined}],['invalid-email',{email:'a@example.com\n'}],['wrong-algorithm-audience',{aud:[CLIENT,'another-client'],azp:'another-client'}]];
 for(const [name,claims,badSignature]of invalid)await t.test(name,async()=>{
  const h=harness(),login=await begin(h);await provider(t,login,{claims,badSignature});
  const response=await handleGoogleAuth(callback(h,login),h.env);assert.equal(response.status,400);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_transactions').get().n,0);t.mock.restoreAll();
 });
});

test('provider failure does not expose code, token or provider error and consumes its transaction',async t=>{
 const h=harness(),login=await begin(h);await provider(t,login,{tokenError:true});const response=await handleGoogleAuth(callback(h,login),h.env);
 assert.equal(response.status,400);assert.doesNotMatch(await response.text(),/synthetic-code|sensitive|invalid_grant|token/);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_transactions').get().n,0);
});

test('parallel callbacks consume state once before the first token exchange finishes',async t=>{
 const h=harness(),login=await begin(h);const calls=await provider(t,login);
 const realMock=globalThis.fetch;let release,started;
 const pending=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{started=resolve;});
 t.mock.method(globalThis,'fetch',async(...args)=>{if(String(args[0]).endsWith('/token')){started();await pending;}return realMock(...args);});
 const first=handleGoogleAuth(callback(h,login),h.env);await waiting;
 const second=await handleGoogleAuth(callback(h,login),h.env);assert.equal(second.status,400);
 release();assert.equal((await first).status,303);assert.equal(calls.filter(url=>url.endsWith('/token')).length,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
});

test('session rotation revokes the old token while a changed Google email retains the same identity',async t=>{
 const h=harness(),one=await begin(h);await provider(t,one);const first=await handleGoogleAuth(callback(h,one),h.env);const old=cookies(first).find(v=>v.startsWith(COOKIE+'='));t.mock.restoreAll();
 await remoteSession(h,old);
 const two=await begin(h);await provider(t,two,{claims:{email:'changed@example.com',name:undefined}});const req=callback(h,two);const headers=new Headers(req.headers);headers.append('cookie',old);
 const second=await handleGoogleAuth(new Request(req.url,{headers}),h.env);assert.equal(second.status,303);const fresh=cookies(second).find(v=>v.startsWith(COOKIE+'='));assert.notEqual(old,fresh);
 assert.equal(await getGoogleUser(h.req('/api/me',{headers:{cookie:old}}),h.env),null);
 assert.deepEqual(await getGoogleUser(h.req('/api/me',{headers:{cookie:fresh}}),h.env),{userId:'google:test-google-subject',email:'changed@example.com',displayName:'changed@example.com',fullName:null});
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
 const remote=h.sqlite.prepare('SELECT status,offer,answer,generation FROM sessions').get();assert.equal(remote.status,'ended');assert.equal(remote.offer,'');assert.equal(remote.answer,null);assert.equal(remote.generation,1);
});

test('signout requires same-origin POST and revokes the server session',async t=>{
 const h=harness(),login=await begin(h);await provider(t,login);const signed=await handleGoogleAuth(callback(h,login),h.env);const session=cookies(signed).find(v=>v.startsWith(COOKIE+'='));await remoteSession(h,session);
 assert.equal((await h.call('/auth/signout',{headers:{cookie:session}})).status,405);
 for(const origin of [undefined,'https://attacker.example','null'])assert.equal((await h.call('/auth/signout',{method:'POST',headers:{cookie:session,...(origin?{origin}:{})}})).status,403);
 assert.equal((await h.call('/auth/signout',{method:'POST',headers:{cookie:session,origin:ORIGIN,'sec-fetch-site':'cross-site'}})).status,403);
 assert.ok(await getGoogleUser(h.req('/api/me',{headers:{cookie:session}}),h.env));
 const response=await h.call('/auth/signout',{method:'POST',headers:{cookie:session,origin:ORIGIN,'sec-fetch-mode':'cors','sec-fetch-site':'same-origin'}});assert.equal(response.status,303);assert.equal(response.headers.get('location'),ORIGIN+'/');
 assert.deepEqual(response.headers.getSetCookie().sort(),[COOKIE,BROWSER].map(name=>`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`).sort());
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert.equal(await getGoogleUser(h.req('/api/me',{headers:{cookie:session}}),h.env),null);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
 const remote=h.sqlite.prepare('SELECT status,offer,answer,generation FROM sessions').get();assert.equal(remote.status,'ended');assert.equal(remote.offer,'');assert.equal(remote.answer,null);assert.equal(remote.generation,1);
});

test('only safe relative return paths survive login; auth routes and encoded redirect tricks are discarded',async()=>{
 const h=harness();
 for(const value of ['https://attacker.example','//attacker.example','/\\attacker.example','/%5cattacker.example','/%2fattacker.example','/%250aLocation:evil','/auth/google','/auth%2fgoogle','/signin-with-chatgpt','/callback','/x\r\nLocation: evil']){
  await begin(h,value);const row=h.sqlite.prepare('SELECT return_path FROM auth_transactions ORDER BY rowid DESC').get();assert.equal(row.return_path,'/',value);
 }
 await begin(h,'/hosts?tab=devices#connect');assert.equal(h.sqlite.prepare('SELECT return_path FROM auth_transactions ORDER BY rowid DESC').get().return_path,'/hosts?tab=devices#connect');
});

test('authentication ignores forged ChatGPT headers, rejects duplicate or expired session cookies and never trusts request Host',async()=>{
 const h=harness();const headers={'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'forged@example.com'};
 assert.equal(await getGoogleUser(h.req('/api/me',{headers}),h.env),null);
 const raw='s'.repeat(43);h.sqlite.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?)').run('google:sub','sub','test@example.com',null,Date.now(),Date.now());h.sqlite.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(await sha(raw),'google:sub',Date.now(),Date.now()+60000);
 assert.ok(await getGoogleUser(h.req('/api/me',{headers:{cookie:COOKIE+'='+raw}}),h.env));
 assert.equal(await getGoogleUser(h.req('/api/me',{headers:{cookie:COOKIE+'='+raw+'; '+COOKIE+'='+raw}}),h.env),null);
 assert.equal(await getGoogleUser(new Request('https://attacker.example/api/me',{headers:{cookie:COOKIE+'='+raw}}),h.env),null);
 assert.equal((await handleGoogleAuth(new Request('https://attacker.example/auth/google'),h.env)).status,400);
 h.sqlite.prepare('UPDATE auth_sessions SET expires=?').run(Date.now()-1);assert.equal(await getGoogleUser(h.req('/api/me',{headers:{cookie:COOKIE+'='+raw}}),h.env),null);
 assert.equal((await h.call('/auth/google',{headers:{origin:'https://attacker.example'}})).status,403);
});

test('missing or unsafe configuration fails closed; local HTTP is restricted to an explicitly configured loopback origin',async()=>{
 const h=harness();
 for(const env of [{},{...h.env,AUTH_BASE_URL:undefined},{...h.env,GOOGLE_CLIENT_SECRET:undefined},{...h.env,AUTH_BASE_URL:'http://www.maclink.example'},{...h.env,AUTH_BASE_URL:'https://www.maclink.example/extra'},{...h.env,AUTH_BASE_URL:'https://user:secret@www.maclink.example'},{...h.env,AUTH_BASE_URL:ORIGIN+'?x=1'}]){
  assert.equal((await handleGoogleAuth(h.req('/auth/google'),env)).status,503);
 }
 assert.equal(await getGoogleUser(h.req('/api/me'),{}),null);
 const env={...h.env,AUTH_BASE_URL:'http://127.0.0.1:5184'};
 const response=await handleGoogleAuth(new Request('http://127.0.0.1:5184/auth/google'),env);assert.equal(response.status,303);assert.match(response.headers.get('set-cookie'),/^maclink_local_oauth=/);assert.doesNotMatch(response.headers.get('set-cookie'),/Secure/);
 assert.equal(new URL(response.headers.get('location')).searchParams.get('redirect_uri'),'http://127.0.0.1:5184/auth/google/callback');
 assert.equal((await handleGoogleAuth(new Request('http://localhost:5184/auth/google'),env)).status,400);
});
