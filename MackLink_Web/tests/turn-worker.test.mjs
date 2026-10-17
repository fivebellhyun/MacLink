import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';

// Use the installed Wrangler dependencies without adding another runtime version.
const require=createRequire(import.meta.url);
const runtimePath=dirname(require.resolve('wrangler/package.json'));
const {Miniflare}=await import(require.resolve('miniflare',{paths:[runtimePath]}));
const {transform}=await import(require.resolve('esbuild',{paths:[runtimePath]}));
const {code}=await transform(await readFile(new URL('../lib/turn.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm',target:'es2022'});
const fakeToken='fake-turn-token-for-worker-tests-only';
const script=code+`\nexport default {async fetch(){try{return Response.json({ok:true,ice:await issueCloudflareIce({keyId:'worker_test_key',apiToken:'${fakeToken}'})});}catch(e){return Response.json({ok:false,status:e.status,error:e.message});}}};`;
const options={modules:true,script,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat']};

test('deployed Workers runtime accepts TURN request options and reaches the provider',async()=>{
 const requests=[];
 const worker=new Miniflare({...options,outboundService:async request=>{
  requests.push({url:request.url,method:request.method,authorization:request.headers.get('Authorization'),body:await request.json()});
  return Response.json({iceServers:[{urls:['turns:turn.cloudflare.com:443?transport=tcp'],username:'ephemeral-user',credential:'ephemeral-password'}]},{status:201});
 }});
 try{
  const result=await (await worker.dispatchFetch('https://unit.test/')).json();
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.ice.turnEnabled,true);
  assert.deepEqual(requests,[{url:'https://rtc.live.cloudflare.com/v1/turn/keys/worker_test_key/credentials/generate-ice-servers',method:'POST',authorization:'Bearer '+fakeToken,body:{ttl:86400}}]);
  assert.equal(JSON.stringify(result).includes(fakeToken),false);
 }finally{await worker.dispose();}
});

test('Workers rejects provider redirects without forwarding the authorization token',async()=>{
 const destinations=[];
 const worker=new Miniflare({...options,outboundService:request=>{
  destinations.push(request.url);
  return new Response(null,{status:302,headers:{Location:'https://unexpected-destination.invalid/'}});
 }});
 try{
  const result=await (await worker.dispatchFetch('https://unit.test/')).json();
  assert.equal(result.ok,false);assert.equal(result.status,502);assert.match(result.error,/주소 이동/);
  assert.equal(destinations.length,1);assert.equal(new URL(destinations[0]).hostname,'rtc.live.cloudflare.com');
  assert.equal(JSON.stringify(result).includes(fakeToken),false);
 }finally{await worker.dispose();}
});
