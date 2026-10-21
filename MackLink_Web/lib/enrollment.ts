import {getGoogleSession,type GoogleAuthBindings} from './google-auth.ts';
import {localizeApiPayload,negotiateLocale} from './i18n-api.ts';

type Enrollment = {
  id:string; claim_hash:string; credential_hash:string; name:string;
  verification_code:string; status:'pending'|'approved'|'cancelled';
  owner:string|null; device:string|null; created:number; expires:number;
  approved:number|null; ip_hash:string; failures:number;
};
type EnrollmentStatus = Enrollment['status']|'expired';
const PENDING_TTL=10*60*1000, RESULT_TTL=24*60*60*1000, START_WINDOW=10*60*1000, START_LIMIT=10, MAX_BODY=8192;
class EnrollmentError extends Error {
  status:number;details:Record<string,unknown>;
  constructor(status:number,message:string,details:Record<string,unknown>={}){super(message);this.status=status;this.details=details;}
}
function ensure(value:unknown,status:number,message:string):asserts value {if(!value)throw new EnrollmentError(status,message);}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');}
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),byte=>byte.toString(16).padStart(2,'0')).join('');
const verificationCode=()=>String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
function configuredOrigin(req:Request,env:GoogleAuthBindings){
  try {
    const base=new URL(env.AUTH_BASE_URL||'');
    const loopback=['127.0.0.1','localhost','[::1]'].includes(base.hostname);
    ensure((base.protocol==='https:'||(base.protocol==='http:'&&loopback))&&!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname==='/'&&(env.AUTH_BASE_URL===base.origin||env.AUTH_BASE_URL===base.origin+'/'),503,'기기 연결 설정이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    ensure(new URL(req.url).origin===base.origin,403,'다른 사이트의 요청은 허용하지 않습니다.');
    return base.origin;
  } catch(error) {if(error instanceof EnrollmentError)throw error;throw new EnrollmentError(503,'기기 연결 설정이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');}
}
async function readBody(req:Request):Promise<Record<string,unknown>>{
  const length=req.headers.get('content-length');
  ensure(length===null||(/^\d+$/.test(length)&&Number(length)<=MAX_BODY),413,'요청이 너무 큽니다.');
  ensure(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json',415,'올바르지 않은 요청입니다.');
  const reader=req.body?.getReader();ensure(reader,400,'올바르지 않은 요청입니다.');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new EnrollmentError(413,'요청이 너무 큽니다.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    ensure(value&&typeof value==='object'&&!Array.isArray(value),400,'올바르지 않은 요청입니다.');return value;
  } catch(error){if(error instanceof EnrollmentError)throw error;throw new EnrollmentError(400,'올바르지 않은 요청입니다.');}
}
function statusOf(row:Enrollment,now:number):EnrollmentStatus {
  if(row.status==='cancelled')return 'cancelled';
  if(row.status==='approved')return row.approved!==null&&row.approved+RESULT_TTL>now?'approved':'expired';
  return row.expires>now?'pending':'expired';
}

/** Pairing never stores or returns a device credential: only its native creator has it. */
export async function handleEnrollment(req:Request,env:GoogleAuthBindings):Promise<Response>{
  const locale=negotiateLocale(req.headers.get('accept-language'));
  const json=(value:unknown,status=200)=>Response.json(localizeApiPayload(value,locale),{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Language':locale,'Vary':'Accept-Language'}});
  try {
    const path=new URL(req.url).pathname.split('/').filter(Boolean).slice(2),method=req.method;let now=Date.now();
    const start=path.length===1&&path[0]==='start'&&method==='POST';
    const id=path[0];
    ensure(start||(path.length===1&&method==='GET')||(path.length===2&&['approve','poll','cancel'].includes(path[1])&&method==='POST'),404,'요청한 경로가 없습니다.');
    if(!start)ensure(typeof id==='string'&&/^[a-f0-9]{24}$/.test(id),404,'기기 연결 요청을 찾을 수 없습니다.');
    const origin=configuredOrigin(req,env);
    ensure(req.headers.get('sec-fetch-site')!=='cross-site'&&(!req.headers.has('origin')||req.headers.get('origin')===origin),403,'다른 사이트의 요청은 허용하지 않습니다.');
    ensure(env.DB,503,'저장소가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');const db=env.DB;
    const sql=(query:string,...values:unknown[])=>db.prepare(query).bind(...values);
    const native=start||path[1]==='poll'||path[1]==='cancel';
    const proof=native?req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]:undefined;
    if(native)ensure(proof,401,'기기 연결 확인 키가 필요합니다.');
    const claimHash=proof?await digest('enrollment-claim:'+proof):null;
    const user=native?null:await getGoogleSession(req,env);
    if(!native){ensure(user,401,'내 기기에 접속하려면 Google로 로그인해 주세요.');if(method!=='GET')ensure(req.headers.get('origin')===origin,403,'다른 사이트의 요청은 허용하지 않습니다.');}
    const find=async(requestId:string)=>sql('SELECT * FROM enrollments WHERE id=?',requestId).first<Enrollment>();
    const publicState=(row:Enrollment,status:EnrollmentStatus)=>({id:row.id,name:row.name,status,expiresAt:row.expires,...(status==='approved'?{deviceId:row.device}:{} )});
    const startState=(row:Enrollment)=>({...publicState(row,statusOf(row,now)),verificationCode:row.verification_code,verificationUrl:origin+'/connect-mac?request='+row.id,pollInterval:4});
    if(start){
      const body=await readBody(req),requestId=body.requestId,name=body.name,credentialHash=body.credentialHash;now=Date.now();
      ensure(typeof requestId==='string'&&/^[a-f0-9]{24}$/.test(requestId)&&typeof credentialHash==='string'&&/^[a-f0-9]{64}$/.test(credentialHash)&&typeof name==='string'&&name.trim().length>0&&name.trim().length<=60&&!/[\x00-\x1f\x7f]/.test(name),400,'올바른 기기 연결 요청을 보내 주세요.');
      const existing=await find(requestId);
      if(existing){ensure(existing.claim_hash===claimHash&&existing.credential_hash===credentialHash,409,'기기 연결 요청이 이미 존재합니다. 커넥터에서 다시 연결해 주세요.');return json(startState(existing));}
      // Cloudflare replaces this header at the edge. Never use caller-controlled
      // forwarding headers or persist an IP address in the pairing record.
      const ip=req.headers.get('cf-connecting-ip');
      const ipHash=await digest('enrollment-ip:'+(ip&&/^[a-f0-9:.]{3,64}$/i.test(ip)?ip:'unavailable'));
      // The server reserves a candidate id at request creation. In the
      // same transaction only the insert winner charges the IP budget, so
      // parallel retries stay idempotent without allowing parallel new starts
      // to bypass the quota.
      const reservedDevice=randomId();
      await db.batch([
        sql("DELETE FROM enrollments WHERE (status='approved' AND approved<=?) OR (status!='approved' AND expires<=?)",now-RESULT_TTL,now-RESULT_TTL),
        sql('DELETE FROM enrollment_limits WHERE window<=?',now-START_WINDOW),
        sql("INSERT INTO enrollments (id,claim_hash,credential_hash,name,verification_code,status,device,created,expires,ip_hash) SELECT ?,?,?,?,?,'pending',?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM enrollment_limits WHERE bucket=? AND window>? AND requests>=?) ON CONFLICT(id) DO NOTHING",requestId,claimHash,credentialHash,name.trim(),verificationCode(),reservedDevice,now,now+PENDING_TTL,ipHash,ipHash,now-START_WINDOW,START_LIMIT),
        sql('INSERT INTO enrollment_limits (bucket,requests,window) SELECT ?,1,? WHERE EXISTS (SELECT 1 FROM enrollments WHERE id=? AND device=?) ON CONFLICT(bucket) DO UPDATE SET requests=enrollment_limits.requests+1',ipHash,now,requestId,reservedDevice),
      ]);
      const created=await find(requestId);ensure(created,429,'기기 연결 요청이 너무 많습니다. 10분 후 다시 시도해 주세요.');ensure(created.claim_hash===claimHash&&created.credential_hash===credentialHash,409,'기기 연결 요청이 이미 존재합니다. 커넥터에서 다시 연결해 주세요.');return json(startState(created),201);
    }
    const row=await find(id);ensure(row,404,'기기 연결 요청을 찾을 수 없습니다.');
    if(native)ensure(row.claim_hash===claimHash,404,'기기 연결 요청을 찾을 수 없습니다.');
    else if(row.owner!==null)ensure(row.owner===user!.userId,404,'기기 연결 요청을 찾을 수 없습니다.');
    let status=statusOf(row,now);
    // Deleted, disabled or reassigned registrations must never be resurrected
    // by replaying an old approval result.
    if(status==='approved'){
      const device=await sql('SELECT id FROM devices WHERE id=? AND owner=? AND agent_hash=? AND enabled=1',row.device,row.owner,row.credential_hash).first();
      if(!device)status='cancelled';
    }
    if(method==='GET')return json(publicState(row,status));
    if(path[1]==='poll')return json({id:row.id,status,expiresAt:row.expires,...(status==='approved'?{config:{site:origin,device:row.device,name:row.name}}:{})});
    if(path[1]==='cancel'){
      if(status!=='pending'&&status!=='approved')return json({id:row.id,status,expiresAt:row.expires});
      // A native request can retract its own new registration until its first
      // heartbeat. The check and deletion are one transaction; a committed
      // heartbeat wins and an already-used device is never removed here.
      await db.batch([
        sql("UPDATE enrollments SET status='cancelled' WHERE id=? AND claim_hash=? AND ((status='pending' AND expires>?) OR (status='approved' AND approved>? AND EXISTS (SELECT 1 FROM devices WHERE devices.id=enrollments.device AND devices.owner=enrollments.owner AND devices.agent_hash=enrollments.credential_hash AND devices.seen=0)))",row.id,claimHash,now,now-RESULT_TTL),
        sql("DELETE FROM devices WHERE seen=0 AND EXISTS (SELECT 1 FROM enrollments WHERE enrollments.id=? AND enrollments.claim_hash=? AND enrollments.status='cancelled' AND enrollments.approved IS NOT NULL AND enrollments.device=devices.id AND enrollments.owner=devices.owner AND enrollments.credential_hash=devices.agent_hash)",row.id,claimHash),
      ]);
      const latest=await find(id);ensure(latest,404,'기기 연결 요청을 찾을 수 없습니다.');status=statusOf(latest,now);
      if(status==='approved')throw new EnrollmentError(409,'이미 연결된 기기입니다. 계속 연결하려면 커넥터에서 확인해 주세요.',{id:row.id,status:'approved',expiresAt:row.expires});
      return json({id:latest.id,status,expiresAt:latest.expires});
    }
    const body=await readBody(req);now=Date.now();status=status==='cancelled'?'cancelled':statusOf(row,now);
    ensure(typeof body.expectedOwnerId==='string'&&body.expectedOwnerId.length<=262,400,'올바른 기기 연결 요청을 보내 주세요.');
    ensure(body.expectedOwnerId===user!.userId,409,'로그인 계정이 변경되었습니다. 계정을 확인한 뒤 다시 승인해 주세요.');
    ensure(status!=='expired',410,'기기 연결 요청이 만료되었습니다. 커넥터에서 다시 연결해 주세요.');
    ensure(row.failures<5,429,'확인 코드 입력 횟수를 초과했습니다. 커넥터에서 다시 연결해 주세요.');
    ensure(status==='pending'||status==='approved',409,'취소된 기기 연결 요청입니다. 커넥터에서 다시 연결해 주세요.');
    const correctCode=typeof body.verificationCode==='string'&&/^\d{6}$/.test(body.verificationCode)&&body.verificationCode===row.verification_code;
    if(!correctCode&&status==='pending'){
      // The attempt budget belongs to the request, not the Google account.
      // A single guarded mutation prevents distributed parallel guesses from
      // passing a stale counter, including an approval racing the fifth error.
      const attempted=await sql("UPDATE enrollments SET failures=failures+1,status=CASE WHEN failures+1>=5 THEN 'cancelled' ELSE status END WHERE id=? AND status='pending' AND expires>? AND failures<5 AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires>?) RETURNING failures",row.id,now,user!.sessionHash,user!.userId,now).first<{failures:number}>();
      const latest=await find(id);ensure(latest,404,'기기 연결 요청을 찾을 수 없습니다.');
      if(latest.owner!==null)ensure(latest.owner===user!.userId,404,'기기 연결 요청을 찾을 수 없습니다.');
      ensure(latest.failures<5,429,'확인 코드 입력 횟수를 초과했습니다. 커넥터에서 다시 연결해 주세요.');
      ensure(statusOf(latest,now)!=='expired',410,'기기 연결 요청이 만료되었습니다. 커넥터에서 다시 연결해 주세요.');
      ensure(latest.status!=='cancelled',409,'취소된 기기 연결 요청입니다. 커넥터에서 다시 연결해 주세요.');
      ensure(attempted||latest.status==='approved',401,'로그인이 종료되었습니다. 다시 로그인해 주세요.');
    }
    ensure(correctCode,400,'커넥터에 표시된 여섯 자리 확인 코드를 확인해 주세요.');
    if(status==='approved')return json(publicState(row,status));
    // Each approval attempt uses a fresh device id as its transaction marker.
    // A retry that lost the guarded status update cannot insert a device later,
    // including after the real winner's registration has been removed.
    const deviceId=randomId(),owner=user!.userId;
    const writes=await db.batch([
      sql("UPDATE enrollments SET status='approved',owner=?,device=?,approved=? WHERE id=? AND status='pending' AND expires>? AND failures<5 AND verification_code=? AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires>?) AND (SELECT COUNT(*) FROM devices WHERE owner=?)<8 AND NOT EXISTS (SELECT 1 FROM devices WHERE id=?)",owner,deviceId,now,row.id,now,row.verification_code,user!.sessionHash,owner,now,owner,deviceId),
      sql("INSERT INTO devices (id,owner,name,agent_hash,created,seen,enabled,info) SELECT ?,owner,name,credential_hash,?,0,1,'{}' FROM enrollments WHERE id=? AND status='approved' AND owner=? AND device=? AND NOT EXISTS (SELECT 1 FROM devices WHERE id=?)",deviceId,now,row.id,owner,deviceId,deviceId),
    ]);
    const latest=await find(id);ensure(latest,404,'기기 연결 요청을 찾을 수 없습니다.');
    if(latest.owner!==null)ensure(latest.owner===owner,404,'기기 연결 요청을 찾을 수 없습니다.');
    if(latest.status==='approved'){
      const device=await sql('SELECT id FROM devices WHERE id=? AND owner=? AND agent_hash=? AND enabled=1',latest.device,latest.owner,latest.credential_hash).first();
      ensure(device,409,'기기 연결 상태가 변경되었습니다. 다시 확인해 주세요.');
      ensure((writes[0].meta.changes===0&&writes[1].meta.changes===0)||(writes[0].meta.changes===1&&writes[1].meta.changes===1),409,'기기 연결 상태가 변경되었습니다. 다시 확인해 주세요.');
      return json(publicState(latest,'approved'));
    }
    ensure(statusOf(latest,now)!=='expired',410,'기기 연결 요청이 만료되었습니다. 커넥터에서 다시 연결해 주세요.');
    ensure(latest.failures<5,429,'확인 코드 입력 횟수를 초과했습니다. 커넥터에서 다시 연결해 주세요.');
    ensure(latest.status!=='cancelled',409,'취소된 기기 연결 요청입니다. 커넥터에서 다시 연결해 주세요.');
    const count=await sql('SELECT COUNT(*) AS n FROM devices WHERE owner=?',owner).first<{n:number}>();
    ensure(count&&count.n<8,409,'최대 8대까지 등록할 수 있습니다.');
    throw new EnrollmentError(401,'로그인이 종료되었습니다. 다시 로그인해 주세요.');
  } catch(error){
    if(error instanceof EnrollmentError)return json({error:error.message,...error.details},error.status);
    console.error('MacLink enrollment request failed');
    return json({error:'기기 연결 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);
  }
}
