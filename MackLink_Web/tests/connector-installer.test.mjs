import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import manifest from '../lib/connector-installer-manifest.json' with {type:'json'};
import {connectorInstaller} from '../lib/connector-installer.ts';

const content=new TextEncoder().encode('abcdefghijklmno');
const demo={filename:'MacLink-Connector-arm64.dmg',version:'1.3.0',size:15,sha256:'a'.repeat(64),parts:[
 {path:'/downloads/connector/example/part-000.bin',size:5},
 {path:'/downloads/connector/example/part-001.bin',size:5},
 {path:'/downloads/connector/example/part-002.bin',size:5},
]};
const url='https://maclink.example/api/downloads/'+demo.filename;
function fetcher({missing=-1,invalid=-1,ignoreRange=false,truncate=-1,omitLength=false}={}){
 const calls=[];let canceled=0;
 return {calls,get canceled(){return canceled;},async fetch(request){
  calls.push(request);
  const index=demo.parts.findIndex(part=>part.path===new URL(request.url).pathname);
  if(index===missing||index<0)return new Response('missing',{status:404});
  let bytes=content.subarray(index*5,index*5+5),status=200;
  const headers=new Headers({'Content-Length':invalid===index?'999':'5'});
  if(request.headers.has('Range')&&!ignoreRange){
   const [,start,end]=/^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range'));
   bytes=bytes.subarray(Number(start),Number(end)+1);status=206;
   headers.set('Content-Length',String(bytes.length));headers.set('Content-Range',`bytes ${start}-${end}/5`);
  }
  if(index===truncate)bytes=bytes.subarray(0,Math.max(0,bytes.length-1));
  if(omitLength)headers.delete('Content-Length');
  const body=new ReadableStream({start(controller){controller.enqueue(bytes);},cancel(){canceled++;}});
  return new Response(body,{status,headers});
 }};
}
const request=(headers={},method='GET',signal)=>new Request(url,{headers,method,signal});

test('packaged pieces reconstruct the exact checksummed installer and fit the static file limit',()=>{
 const hash=createHash('sha256');let size=0;
 for(const part of manifest.parts){
  const bytes=readFileSync(new URL('../public'+part.path,import.meta.url));
  assert.equal(bytes.length,part.size);assert.ok(bytes.length<=20*1024*1024);
  hash.update(bytes);size+=bytes.length;
 }
 assert.equal(size,manifest.size);assert.equal(hash.digest('hex'),manifest.sha256);
});

test('full download streams ordered bytes with attachment, length and integrity metadata',async()=>{
 const assets=fetcher();const response=await connectorInstaller(request(),assets,demo);
 assert.equal(response.status,200);assert.equal(assets.calls.length,1);
 assert.equal(response.headers.get('Content-Type'),'application/x-apple-diskimage');
 assert.equal(response.headers.get('Content-Length'),'15');
 assert.equal(response.headers.get('Content-Disposition'),'attachment; filename="'+demo.filename+'"');
 assert.equal(response.headers.get('ETag'),'"'+demo.sha256+'"');
 assert.equal(await response.text(),'abcdefghijklmno');assert.equal(assets.calls.length,3);
});

test('internal ASSETS responses without Content-Length stream the manifest-sized full and resumed download',async()=>{
 const full=await connectorInstaller(request(),fetcher({omitLength:true}),demo);
 assert.equal(full.status,200);assert.equal(full.headers.get('Content-Length'),'15');
 assert.equal(await full.text(),'abcdefghijklmno');
 const partial=await connectorInstaller(request({Range:'bytes=3-11'}),fetcher({omitLength:true}),demo);
 assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Length'),'9');
 assert.equal(await partial.text(),'defghijkl');
});

test('HEAD, checksum and conditional requests do not read binary assets',async()=>{
 const assets=fetcher();
 const head=await connectorInstaller(request({},'HEAD'),assets,demo);
 assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'15');assert.equal(await head.text(),'');
 const checksum=await connectorInstaller(new Request(url+'.sha256'),assets,demo);
 assert.equal(await checksum.text(),demo.sha256+'  '+demo.filename+'\n');
 const checksumHead=await connectorInstaller(new Request(url+'.sha256',{method:'HEAD'}),assets,demo);
 assert.equal(await checksumHead.text(),'');assert.equal(checksumHead.headers.get('Content-Length'),String(demo.sha256.length+demo.filename.length+3));
 const cached=await connectorInstaller(request({'If-None-Match':'"'+demo.sha256+'"'}),assets,demo);
 assert.equal(cached.status,304);assert.equal(assets.calls.length,0);
});

test('resumed ranges cross part boundaries and suffix ranges select the right bytes',async()=>{
 const assets=fetcher();const response=await connectorInstaller(request({Range:'bytes=3-11'}),assets,demo);
 assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 3-11/15');
 assert.equal(response.headers.get('Content-Length'),'9');assert.equal(await response.text(),'defghijkl');
 assert.equal(assets.calls[0].headers.get('Range'),'bytes=3-4');
 const suffix=await connectorInstaller(request({Range:'bytes=-3'}),fetcher(),demo);
 assert.equal(await suffix.text(),'mno');
 const open=await connectorInstaller(request({Range:'bytes=12-'}),fetcher(),demo);
 assert.equal(await open.text(),'mno');
});

test('a static backend that ignores Range still yields the exact requested bytes',async()=>{
 const response=await connectorInstaller(request({Range:'bytes=3-11'}),fetcher({ignoreRange:true}),demo);
 assert.equal(response.status,206);assert.equal(await response.text(),'defghijkl');
});

test('invalid and multiple ranges fail without fetching; stale If-Range gets the full file',async()=>{
 const assets=fetcher();
 for(const Range of ['bytes=100-','bytes=5-3','bytes=-0','bytes=0-1,3-4','bytes=-','bytes=90071992547409999-']){
  const response=await connectorInstaller(request({Range}),assets,demo);
  assert.equal(response.status,416);assert.equal(response.headers.get('Content-Range'),'bytes */15');
 }
 assert.equal(assets.calls.length,0);
 const full=await connectorInstaller(request({Range:'bytes=1-2','If-Range':'"older-version"'}),assets,demo);
 assert.equal(full.status,200);assert.equal(await full.text(),'abcdefghijklmno');
});

test('asset allowlist, method and missing storage are enforced',async()=>{
 const assets=fetcher();
 assert.equal((await connectorInstaller(new Request(url.replace('arm64','x86_64')),assets,demo)).status,404);
 assert.equal((await connectorInstaller(request({},'POST'),assets,demo)).status,405);
 assert.equal((await connectorInstaller(request(),undefined,demo)).status,503);
 assert.equal(assets.calls.length,0);
});

test('missing or invalid first part fails before serving an attachment',async()=>{
 for(const option of [{missing:0},{invalid:0}]){
  const response=await connectorInstaller(request(),fetcher(option),demo);
  assert.equal(response.status,503);assert.equal(response.headers.has('Content-Disposition'),false);
 }
});

test('missing later parts interrupt the stream instead of returning a partial successful file',async()=>{
 const response=await connectorInstaller(request(),fetcher({missing:1}),demo);
 await assert.rejects(response.arrayBuffer(),/Installer part is unavailable/);
});

test('request abort cancels the active asset reader and never opens later parts',async()=>{
 const controller=new AbortController(),assets=fetcher();
 const response=await connectorInstaller(request({},'GET',controller.signal),assets,demo);
 const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'abcde');
 controller.abort();await assert.rejects(reader.read(),error=>error.name==='AbortError');
 assert.equal(assets.calls.length,1);assert.equal(assets.canceled,1);
 const aborted=await connectorInstaller(request({},'GET',controller.signal),assets,demo);
 assert.equal(aborted.status,499);assert.equal(assets.calls.length,1);
});

test('consumer cancellation releases its reader and opens no further assets',async()=>{
 const assets=fetcher(),response=await connectorInstaller(request(),assets,demo);
 await response.body.cancel();assert.equal(assets.canceled,1);assert.equal(assets.calls.length,1);
});

function delayedFetcher(part){
 const assets=fetcher();const original=assets.fetch.bind(assets);
 let release,notify;
 const started=new Promise(resolve=>{notify=resolve;});
 assets.fetch=async request=>{
  const response=await original(request);
  if(assets.calls.length!==part)return response;
  notify();return await new Promise(resolve=>{release=()=>resolve(response);});
 };
 return {assets,started,release:()=>release()};
}

test('abort while the first asset fetch is pending cancels the acquired body and returns no attachment',async()=>{
 const controller=new AbortController(),delayed=delayedFetcher(1);
 const pending=connectorInstaller(request({},'GET',controller.signal),delayed.assets,demo);
 await delayed.started;controller.abort();delayed.release();
 const response=await pending;assert.equal(response.status,499);
 assert.equal(delayed.assets.canceled,1);assert.equal(delayed.assets.calls.length,1);
});

test('abort between parts cancels an asset that arrives after the stream has closed',async()=>{
 const controller=new AbortController(),delayed=delayedFetcher(2);
 const response=await connectorInstaller(request({},'GET',controller.signal),delayed.assets,demo);
 const reader=response.body.getReader();await reader.read();
 const pending=reader.read();await delayed.started;controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');delayed.release();
 await new Promise(setImmediate);
 assert.equal(delayed.assets.canceled,2);assert.equal(delayed.assets.calls.length,2);
});

test('consumer cancellation between parts closes a late asset without enqueueing more data',async()=>{
 const delayed=delayedFetcher(2),response=await connectorInstaller(request(),delayed.assets,demo);
 const reader=response.body.getReader();await reader.read();
 const pending=reader.read();await delayed.started;await reader.cancel();delayed.release();
 assert.equal((await pending).done,true);await new Promise(setImmediate);
 assert.equal(delayed.assets.canceled,2);assert.equal(delayed.assets.calls.length,2);
});

test('Workers FixedLengthStream receives the full or ranged length and preserves abort propagation',async()=>{
 const original=globalThis.FixedLengthStream,lengths=[];
 globalThis.FixedLengthStream=class extends TransformStream {
  constructor(length){
   let written=0;
   super({transform(bytes,controller){written+=bytes.length;if(written>length)throw new Error('Too many bytes');controller.enqueue(bytes);},flush(){assert.equal(written,length);}});
   lengths.push(length);
  }
 };
 try {
  const full=await connectorInstaller(request(),fetcher(),demo);
  assert.equal(await full.text(),'abcdefghijklmno');
  const range=await connectorInstaller(request({Range:'bytes=3-11'}),fetcher(),demo);
  assert.equal(await range.text(),'defghijkl');assert.deepEqual(lengths,[15,9]);
  const controller=new AbortController(),assets=fetcher();
  const response=await connectorInstaller(request({},'GET',controller.signal),assets,demo);
  const reader=response.body.getReader();await reader.read();controller.abort();
  await assert.rejects(reader.read(),error=>error.name==='AbortError');
  assert.ok(assets.canceled>=1);
 }finally{
  if(original===undefined)delete globalThis.FixedLengthStream;else globalThis.FixedLengthStream=original;
 }
});
