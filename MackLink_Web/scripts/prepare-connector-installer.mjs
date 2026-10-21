// Usage: node scripts/prepare-connector-installer.mjs /absolute/path/to/installer.dmg [version]
// Package large installers as bounded static assets; the download route streams them.
import {createHash} from 'node:crypto';
import {open, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [input,version='1.4.0']=process.argv.slice(2);
if(!input||!path.isAbsolute(input))throw new Error('Pass an absolute path to the built arm64 DMG.');
if(!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(version))throw new Error('Invalid version.');
const filename=path.basename(input);
if(filename!=='MacLink-Connector-arm64.dmg')throw new Error('Only the verified Apple silicon installer is currently available.');
const chunkSize=20*1024*1024;
const file=await open(input,'r');
const hash=createHash('sha256');
const pieces=[];
try {
 const buffer=Buffer.allocUnsafe(chunkSize);
 for(let offset=0;;){
  const {bytesRead}=await file.read(buffer,0,buffer.length,offset);
  if(!bytesRead)break;
  const content=Buffer.from(buffer.subarray(0,bytesRead));
  hash.update(content);pieces.push(content);offset+=bytesRead;
 }
} finally {await file.close();}
if(!pieces.length)throw new Error('Installer is empty.');
const sha256=hash.digest('hex');
const relative=`downloads/connector/${version}-${sha256}`;
const directory=path.join(project,'public',relative);
await mkdir(directory,{recursive:true});
const parts=[];
for(const [index,content]of pieces.entries()){
 const name=`part-${String(index).padStart(3,'0')}.bin`;
 await writeFile(path.join(directory,name),content);
 parts.push({path:`/${relative}/${name}`,size:content.length});
}
const installer={version,filename,size:parts.reduce((sum,part)=>sum+part.size,0),sha256,parts};
await mkdir(path.join(project,'lib'),{recursive:true});
await writeFile(path.join(project,'lib/connector-installer-manifest.json'),JSON.stringify(installer,null,2)+'\n');
// Keep only the manifest's content-addressed set so a rebuild cannot package stale parts.
const {readdir}=await import('node:fs/promises');
for(const name of await readdir(path.join(project,'public/downloads/connector'))){
 if(name!==path.basename(directory))await rm(path.join(project,'public/downloads/connector',name),{recursive:true,force:true});
}
console.log(`Prepared ${filename}: ${installer.size} bytes, ${parts.length} parts, SHA-256 ${sha256}`);
