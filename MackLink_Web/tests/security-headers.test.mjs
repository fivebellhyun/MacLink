import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withSecurityHeaders} from '../lib/security-headers.ts';

const securityHeaders={
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
};

test('HTML cannot be framed while its existing CSP and response metadata are preserved',async()=>{
 const original=new Response('<h1>MacLink</h1>',{
  status:200,statusText:'OK',headers:{
   'Content-Type':'text/html; charset=utf-8',
   'Content-Security-Policy':"script-src 'nonce-unit-test'; frame-ancestors 'self'",
   'Cache-Control':'private, no-store','Vary':'Accept-Language',
   'Set-Cookie':'test=value; Secure; HttpOnly',
  },
 });
 const secured=withSecurityHeaders(original);
 assert.equal(secured.status,200);assert.equal(secured.statusText,'OK');
 for(const [header,value] of Object.entries(securityHeaders))assert.equal(secured.headers.get(header),value);
 assert.equal(secured.headers.get('Content-Security-Policy'),"script-src 'nonce-unit-test'; frame-ancestors 'self', frame-ancestors 'none'");
 for(const header of ['Content-Type','Cache-Control','Vary','Set-Cookie'])assert.equal(secured.headers.get(header),original.headers.get(header));
 assert.equal(original.headers.has('X-Frame-Options'),false);
 assert.equal(await secured.text(),'<h1>MacLink</h1>');
});

test('partial installer downloads keep exact bytes, range, length and integrity headers',async()=>{
 const original=new Response(new Uint8Array([255,0,1,2]),{status:206,headers:{
  'Content-Type':'application/x-apple-diskimage','Content-Length':'4',
  'Content-Range':'bytes 10-13/100','Accept-Ranges':'bytes',
  'Content-Disposition':'attachment; filename="MacLink-Connector-arm64.dmg"',
  ETag:'"test-digest"','Cache-Control':'public, max-age=3600',
 }});
 const secured=withSecurityHeaders(original);
 assert.equal(secured.status,206);
 for(const [header,value] of original.headers)assert.equal(secured.headers.get(header),value);
 assert.deepEqual(new Uint8Array(await secured.arrayBuffer()),new Uint8Array([255,0,1,2]));
});

test('wrapping never buffers a streaming response and propagates consumer cancellation',async()=>{
 let canceled=false;
 const body=new ReadableStream({cancel(){canceled=true;}});
 const original=new Response(body),secured=withSecurityHeaders(original);
 assert.equal(secured.body,body);assert.equal(secured.bodyUsed,false);
 assert.equal(secured.headers.get('Content-Security-Policy'),"frame-ancestors 'none'");
 await secured.body.cancel();assert.equal(canceled,true);
});

test('redirects with immutable headers and bodyless HTTP responses remain valid',async()=>{
 const redirect=withSecurityHeaders(Response.redirect('https://maclink.example/',302));
 assert.equal(redirect.status,302);assert.equal(redirect.headers.get('Location'),'https://maclink.example/');
 for(const status of [204,304]){
  const secured=withSecurityHeaders(new Response(null,{status,headers:{ETag:'"unchanged"'}}));
  assert.equal(secured.status,status);assert.equal(secured.body,null);
  assert.equal(secured.headers.get('ETag'),'"unchanged"');
  assert.equal(secured.headers.get('X-Frame-Options'),'DENY');
 }
});
