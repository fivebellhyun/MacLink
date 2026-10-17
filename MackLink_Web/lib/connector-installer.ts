import manifest from './connector-installer-manifest.json' with {type:'json'};

export type InstallerManifest={filename:string;version:string;size:number;sha256:string;parts:{path:string;size:number}[]};
export type AssetFetcher={fetch:(request:Request)=>Promise<Response>};
type Segment={path:string;size:number;start:number;end:number};

function requestedRange(value:string|null,size:number):[number,number]|null|false {
 if(!value)return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!match||(!match[1]&&!match[2]))return false;
 if(!match[1]){
  const suffix=Number(match[2]);
  return Number.isSafeInteger(suffix)&&suffix>0?[Math.max(0,size-suffix),size-1]:false;
 }
 const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),size-1):size-1;
 return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start?[start,end]:false;
}

export async function connectorInstaller(request:Request,assets:AssetFetcher|undefined,installer:InstallerManifest=manifest):Promise<Response> {
 const pathname=new URL(request.url).pathname;
 const checksum=pathname===`/api/downloads/${installer.filename}.sha256`;
 if(!checksum&&pathname!==`/api/downloads/${installer.filename}`)return new Response('Installer not found.',{status:404});
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed.',{status:405,headers:{Allow:'GET, HEAD'}});
 if(request.signal.aborted)return new Response(null,{status:499});
 const etag=`"${installer.sha256}${checksum?'-checksum':''}"`;
 const headers=new Headers({'Cache-Control':'public, max-age=0, must-revalidate','ETag':etag,'X-Content-Type-Options':'nosniff'});
 if(request.headers.get('If-None-Match')?.split(',').some(value=>value.trim()===etag||value.trim()==='*'))return new Response(null,{status:304,headers});
 if(checksum){
  const text=`${installer.sha256}  ${installer.filename}\n`;
  headers.set('Content-Type','text/plain; charset=utf-8');headers.set('Content-Length',String(new TextEncoder().encode(text).length));
  headers.set('Content-Disposition',`attachment; filename="${installer.filename}.sha256"`);
  return new Response(request.method==='HEAD'?null:text,{headers});
 }
 headers.set('Content-Type','application/x-apple-diskimage');headers.set('Content-Disposition',`attachment; filename="${installer.filename}"`);headers.set('Accept-Ranges','bytes');
 const ifRange=request.headers.get('If-Range');
 const range=requestedRange(!ifRange||ifRange===etag?request.headers.get('Range'):null,installer.size);
 if(range===false){headers.set('Content-Range',`bytes */${installer.size}`);return new Response(null,{status:416,headers});}
 const [start,end]=range||[0,installer.size-1];
 headers.set('Content-Length',String(end-start+1));
 if(range)headers.set('Content-Range',`bytes ${start}-${end}/${installer.size}`);
 if(request.method==='HEAD')return new Response(null,{status:range?206:200,headers});
 if(!assets)return new Response('Installer storage is unavailable.',{status:503});
 const segments:Segment[]=[];let offset=0;
 for(const part of installer.parts){
  if(offset<=end&&offset+part.size>start)segments.push({...part,start:Math.max(0,start-offset),end:Math.min(part.size-1,end-offset)});
  offset+=part.size;
 }
 if(offset!==installer.size||!segments.length)return new Response('Installer metadata is invalid.',{status:503});
 let index=0,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,skip=0,remaining=0,closed=false;
 const load=async()=>{
  const segment=segments[index];
  const url=new URL(segment.path,request.url);
  const partHeaders=new Headers();
  if(segment.start!==0||segment.end!==segment.size-1)partHeaders.set('Range',`bytes=${segment.start}-${segment.end}`);
  const response=await assets.fetch(new Request(url,{headers:partHeaders,signal:request.signal}));
  if(closed||request.signal.aborted){await response.body?.cancel();throw new DOMException('Download aborted.','AbortError');}
  if((response.status!==200&&response.status!==206)||!response.body){await response.body?.cancel();throw new Error('Installer part is unavailable.');}
  // The internal Workers ASSETS binding omits Content-Length even though the
  // public HTTP response includes it. The manifest and fixed-length output
  // still bound the download; validate a length only when the binding supplies one.
  const length=response.headers.get('Content-Length');
  const expected=response.status===206?segment.end-segment.start+1:segment.size;
  if((length!==null&&Number(length)!==expected)||(response.status===206&&response.headers.get('Content-Range')!==`bytes ${segment.start}-${segment.end}/${segment.size}`)){
   await response.body.cancel();throw new Error('Installer part is invalid.');
  }
  skip=response.status===206?0:segment.start;remaining=segment.end-segment.start+1;reader=response.body.getReader();
 };
 try {await load();}catch{return new Response('Installer is temporarily unavailable.',{status:request.signal.aborted?499:503});}
 let abort:()=>void=()=>{};
 const finish=()=>{closed=true;request.signal.removeEventListener('abort',abort);};
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   abort=()=>{if(closed)return;finish();void reader?.cancel().catch(()=>{});controller.error(new DOMException('Download aborted.','AbortError'));};
   request.signal.addEventListener('abort',abort,{once:true});
   if(request.signal.aborted)abort();
  },
  async pull(controller){
   try {
    while(!closed){
     if(remaining===0){
      await reader!.cancel();reader=undefined;index++;
      if(index===segments.length){finish();controller.close();return;}
      await load();
     }
     const {value,done}=await reader!.read();
     if(closed)return;
     if(done)throw new Error('Installer part ended early.');
     if(skip>=value.length){skip-=value.length;continue;}
     const content=value.subarray(skip,Math.min(value.length,skip+remaining));skip=0;
     remaining-=content.length;controller.enqueue(content);return;
    }
   }catch(error){if(!closed){finish();void reader?.cancel().catch(()=>{});controller.error(error);}}
  },
  async cancel(){finish();await reader?.cancel();},
 });
 // Workers derives Content-Length from its body source and ignores a manually
 // assigned header for ordinary streams. Its fixed-length stream also detects
 // truncation while keeping the download and cancellation paths streaming.
 const body=typeof FixedLengthStream==='function'?stream.pipeThrough(new FixedLengthStream(end-start+1)):stream;
 return new Response(body,{status:range?206:200,headers});
}
