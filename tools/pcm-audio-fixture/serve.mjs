// Strict loopback only. No account, device, capture, or production API calls.
import http from 'node:http';
import {readFileSync} from 'node:fs';
const server=http.createServer((req,out)=>{
 try{
  if(req.headers.host!=='127.0.0.1:5314'){out.writeHead(400);return out.end('Loopback only');}
  const url=new URL(req.url,'http://127.0.0.1:5314');
  if(['/', '/fixture/audio', '/audio-fixture.html'].includes(url.pathname)){out.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return out.end(readFileSync(new URL('../../.build/pcm-audio-fixture/index.html',import.meta.url)));}
  if(url.pathname==='/favicon.ico'){out.writeHead(204);return out.end();}
  out.writeHead(404);out.end('No external resources or live API');
 }catch{out.writeHead(502);out.end('Local preview unavailable');}
});
server.listen(5314,'127.0.0.1',()=>console.log('PCM local fixture http://127.0.0.1:5314/fixture/audio'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
