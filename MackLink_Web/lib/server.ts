import {connectionIce,turnStatus,saveTurn,removeTurn,TurnError,type TurnBindings} from './turn.ts';
import {isVideoQuality} from './quality.ts';
import {localizeApiPayload,negotiateLocale} from './i18n-api.ts';
import {getGoogleUser,type GoogleAuthBindings} from './google-auth.ts';
type Bindings = TurnBindings & GoogleAuthBindings;
type Row = Record<string, any>;
class ApiError extends Error { status:number; constructor(status: number, message: string) { super(message); this.status=status; } }
const assert = (ok: unknown, status: number, message: string): void => { if (!ok) throw new ApiError(status, message); };
const random = (n=32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), v=>v.toString(16).padStart(2,'0')).join('');
export async function hash(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join(''); }
export function normalizeHostEmail(value: unknown): string | null {
  if(typeof value!=='string')return null;
  const email=value.trim().toLowerCase();
  return email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
const emailDigest=(owner:string,email:string)=>hash('host-email:'+owner+':'+email);
export async function handleApi(req: Request, env: Bindings): Promise<Response> {
  const locale=negotiateLocale(req.headers.get('Accept-Language'));
  const json=(data:unknown,status=200)=>Response.json(localizeApiPayload(data,locale),{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Language':locale,'Vary':'Accept-Language'}});
  try {
    const path = new URL(req.url).pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);
    const method=req.method, now=Date.now(), db=env.DB;
    if((path[0]==='agent'&&(path.length!==3||!['check','poll','decision','answer','recover','end'].includes(path[2])))||(path[0]==='sessions'&&path.length>2&&(path.length!==3||!['ice','quality','end','resume'].includes(path[2]))))return json({error:'요청한 경로가 없습니다.'},404);
    // Owner sessions are independent of platform headers. Agent/guest traffic
    // keeps its existing bearer flow without a browser-session database read.
    const user=['me','devices','network'].includes(path[0])?await getGoogleUser(req,env):null;
    const owner=user?.userId??null;
    const ownerEmail=normalizeHostEmail(user?.email);
    const auth=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? '';
    if (method !== 'GET' && req.headers.has('Origin')) assert(req.headers.get('Origin')===new URL(req.url).origin,403,'다른 사이트의 요청은 허용하지 않습니다.');
    if (path[0] === 'me' && method==='GET') {
      if(owner && ownerEmail){
        assert(db,503,'저장소가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
        await db!.prepare('INSERT INTO owner_identities (owner,email_hash,updated) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET email_hash=excluded.email_hash,updated=excluded.updated WHERE owner_identities.email_hash!=excluded.email_hash').bind(owner,await emailDigest(owner,ownerEmail),now).run();
      }
      return json({signedIn:!!owner,email:owner?ownerEmail:null});
    }
    assert(db,503,'저장소가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    const sql=(q:string,...args:any[])=>db!.prepare(q).bind(...args);
    const body=async()=>{ assert(Number(req.headers.get('Content-Length')||0)<=160000,413,'요청이 너무 큽니다.'); const raw=await req.text();assert(raw.length<=160000,413,'요청이 너무 큽니다.');try{return JSON.parse(raw);}catch{throw new ApiError(400,'올바르지 않은 요청입니다.');} };
    const requireOwner=()=>{
      assert(owner,401,'맥북을 등록하려면 Google로 로그인해 주세요.');
      if(method!=='GET')assert(req.headers.get('Origin')===new URL(req.url).origin,403,'다른 사이트의 요청은 허용하지 않습니다.');
    };
    const syncOwnerEmail=async()=>{
      assert(owner && ownerEmail,403,'로그인 이메일을 확인할 수 없습니다. 다시 로그인해 주세요.');
      await sql('INSERT INTO owner_identities (owner,email_hash,updated) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET email_hash=excluded.email_hash,updated=excluded.updated WHERE owner_identities.email_hash!=excluded.email_hash',owner,await emailDigest(owner!,ownerEmail!),now).run();
    };
    const verifyHostEmail=async(invite:Row,d:Row,value:unknown)=>{
      const email=normalizeHostEmail(value);
      assert(email,400,'호스트 이메일 주소를 올바르게 입력해 주세요.');
      // Reserve before checking: parallel guesses cannot all pass a stale counter read.
      // Successful checks refund their slot; failed checks consume the shared budget.
      const attempt=await sql('INSERT INTO invite_verifications (invite,failures,window) VALUES (?,1,?) ON CONFLICT(invite) DO UPDATE SET failures=CASE WHEN invite_verifications.window<=? THEN 1 ELSE invite_verifications.failures+1 END,window=CASE WHEN invite_verifications.window<=? THEN excluded.window ELSE invite_verifications.window END WHERE invite_verifications.window<=? OR invite_verifications.failures<10 RETURNING window',invite.id,now,now-300000,now-300000,now-300000).first<Row>();
      assert(attempt,429,'확인 시도가 너무 많습니다. 5분 후 다시 시도하거나 새 초대를 요청해 주세요.');
      const identity=await sql('SELECT email_hash FROM owner_identities WHERE owner=?',d.owner).first<Row>();
      if(!identity || identity.email_hash!==await emailDigest(d.owner,email!)){
        throw new ApiError(403,'초대 링크와 호스트 이메일을 확인해 주세요. 호스트는 로그인한 상태로 MacLink 웹사이트를 한 번 열어야 합니다.');
      }
      await sql('UPDATE invite_verifications SET failures=MAX(0,failures-1) WHERE invite=? AND window=?',invite.id,attempt!.window).run();
    };
    if(path[0]==='network'){
      requireOwner();
      if(path.length===1&&method==='GET')return json(await turnStatus(env,owner!));
      if(path.length===1&&method==='POST')return json(await saveTurn(env,owner!,await body()));
      if(path.length===1&&method==='DELETE'){await removeTurn(env,owner!);return json({configured:false});}
      if(path[1]==='ice'&&path.length===2&&method==='GET')return json(await connectionIce(env,owner!,'owner:'+owner));
    }
    const deviceOwner=async(id:string)=>{requireOwner(); const d=await sql('SELECT * FROM devices WHERE id=? AND owner=?',id,owner).first<Row>();assert(d,404,'기기를 찾을 수 없습니다.');return d!;};
    const agent=async(id:string)=>{assert(auth,401,'연결 키가 필요합니다.');const d=await sql('SELECT * FROM devices WHERE id=? AND agent_hash=? AND enabled=1',id,await hash(auth)).first<Row>();assert(d,401,'맥 연결 키가 만료되었거나 해제되었습니다.');return d!;};
    const finish=async(s:Row,reason:string,guardGeneration=false)=>{await sql("UPDATE sessions SET status='ended',reason=?,offer='',answer=NULL WHERE id=?"+(guardGeneration?' AND generation=?':''),reason,s.id,...(guardGeneration?[s.generation]:[])).run();};
    const suspend=async(s:Row,reason:string)=>{await sql("UPDATE sessions SET status='reconnecting',reason=?,offer='',answer=NULL WHERE id=? AND generation=? AND status IN ('active','approved')",reason,s.id,s.generation).run();};
    // Recheck freshness in the mutation: a heartbeat can arrive after the stale read.
    const expireLease=async(s:Row,reason:string,checkDevice=false)=>{const r=await sql("UPDATE sessions SET status=CASE WHEN status='pending' THEN 'ended' ELSE 'reconnecting' END,reason=CASE WHEN status='pending' THEN ? ELSE ? END,offer='',answer=NULL WHERE id=? AND generation=? AND status IN ('pending','approved','active') AND (seen<?"+(checkDevice?" OR EXISTS (SELECT 1 FROM devices WHERE devices.id=sessions.device AND enabled=1 AND seen<?)":"")+")",'승인 전 연결 요청이 끊어졌습니다.',reason,s.id,s.generation,now-20000,...(checkDevice?[now-15000]:[])).run();return !!r.meta.changes;};
    const cleanup=async(device:string)=>{const stale=await sql("SELECT * FROM sessions WHERE device=? AND status IN ('pending','approved','active') AND seen<?",device,now-20000).all<Row>();for(const s of stale.results)await expireLease(s,'네트워크 복구를 기다리고 있습니다.');};
    const guest=async(id:string)=>{assert(auth,401,'세션 키가 필요합니다.');const guestHash=await hash(auth);let s=await sql('SELECT * FROM sessions WHERE id=? AND guest_hash=?',id,guestHash).first<Row>();assert(s,404,'세션을 찾을 수 없습니다.');
      if(s!.status!=='ended') {const d=await sql('SELECT enabled,seen FROM devices WHERE id=?',s!.device).first<Row>();
        if(!d?.enabled){await finish(s!,'기기 접속 권한이 해제되었습니다.');s!.status='ended';}
        else if(s!.seen<now-20000 || d.seen<now-15000){await expireLease(s!,'맥북 또는 네트워크 복구를 기다리고 있습니다.',true);s=await sql('SELECT * FROM sessions WHERE id=? AND guest_hash=?',id,guestHash).first<Row>();assert(s,404,'세션을 찾을 수 없습니다.');}
      }return s!;};
    if (path[0] === 'devices' && path.length === 1) {
      requireOwner();
      if(method==='GET') {
        const ds=await sql('SELECT id,name,seen,enabled,info,created FROM devices WHERE owner=? ORDER BY created DESC',owner).all<Row>();
        for(const d of ds.results){await cleanup(d.id);d.persistentCount=(await sql('SELECT COUNT(*) AS n FROM invites WHERE device=? AND reusable=1',d.id).first<Row>())!.n;d.info=JSON.parse(d.info);d.online=!!d.enabled&&d.seen>now-12000;d.sessions=(await sql('SELECT id,guest_name,mode,status,created,reason FROM sessions WHERE device=? ORDER BY created DESC LIMIT 6',d.id).all()).results;}
        return json({devices:ds.results});
      }
      if(method==='POST') {
        await syncOwnerEmail();
        const b=await body();assert(typeof b.name==='string' && b.name.trim().length>0 && b.name.length<=60,400,'기기 이름은 1~60자로 입력해 주세요.');
        const count=await sql('SELECT COUNT(*) AS n FROM devices WHERE owner=?',owner).first<Row>();assert(count!.n<8,409,'최대 8대까지 등록할 수 있습니다.');
        const id=random(12),token=random();await sql('INSERT INTO devices (id,owner,name,agent_hash,created,seen,enabled,info) VALUES (?,?,?,?,?,0,1,?)',id,owner,b.name.trim(),await hash(token),now,'{}').run();
        return json({id,token,name:b.name.trim()},201);
      }
    }
    if(path[0]==='devices' && path[1]==='claim' && path.length===2 && method==='POST') {
      requireOwner();
      const b=await body();
      assert(b && typeof b==='object' && b.confirm===true && typeof b.device==='string' && /^[a-f0-9]{24}$/.test(b.device) && typeof b.token==='string' && /^[a-f0-9]{64}$/.test(b.token),400,'기존 연결 키 파일을 확인하고 기기 가져오기를 승인해 주세요.');
      const keyHash=await hash(b.token);
      const d=await sql('SELECT id,owner,name FROM devices WHERE id=? AND agent_hash=? AND enabled=1',b.device,keyHash).first<Row>();
      assert(d,403,'기존 연결 키로 기기를 확인할 수 없습니다.');
      if(d!.owner===owner)return json({ok:true,id:d!.id,name:d!.name,alreadyOwned:true});
      assert(!d!.owner.startsWith('google:'),409,'이미 다른 Google 계정에 연결된 기기입니다.');
      await syncOwnerEmail();
      // Each statement uses the same compare-and-swap guard. A competing claim
      // cannot revoke the winner's new invitations or sessions. Ownership moves
      // last, in this atomic batch; the connector secret itself is unchanged.
      const guard='EXISTS (SELECT 1 FROM devices WHERE id=? AND owner=? AND agent_hash=? AND enabled=1 AND owner NOT LIKE \'google:%\') AND (SELECT COUNT(*) FROM devices WHERE owner=?)<8';
      const guardArgs=[d!.id,d!.owner,keyHash,owner];
      const result=await db!.batch([
        sql('DELETE FROM invite_verifications WHERE invite IN (SELECT id FROM invites WHERE device=?) AND '+guard,d!.id,...guardArgs),
        sql("UPDATE sessions SET status='ended',reason='기기 소유 계정이 변경되었습니다.',offer='',answer=NULL,generation=generation+1 WHERE device=? AND "+guard,d!.id,...guardArgs),
        sql('DELETE FROM invites WHERE device=? AND '+guard,d!.id,...guardArgs),
        sql('UPDATE devices SET owner=? WHERE id=? AND '+guard,owner,d!.id,...guardArgs),
      ]);
      if(!result[result.length-1].meta.changes){
        const current=await sql('SELECT owner FROM devices WHERE id=? AND agent_hash=? AND enabled=1',d!.id,keyHash).first<Row>();
        if(current?.owner===owner)return json({ok:true,id:d!.id,name:d!.name,alreadyOwned:true});
        assert((await sql('SELECT COUNT(*) AS n FROM devices WHERE owner=?',owner).first<Row>())!.n<8,409,'최대 8대까지 등록할 수 있습니다.');
        throw new ApiError(409,'기기 소유권이 변경되었습니다. 다시 확인해 주세요.');
      }
      return json({ok:true,id:d!.id,name:d!.name,alreadyOwned:false});
    }
    if(path[0]==='devices' && path[1]) {
      const d=await deviceOwner(path[1]);
      if(path[2]==='invite' && method==='POST') {
        await syncOwnerEmail();
        await sql('DELETE FROM invite_verifications WHERE window<=?',now-300000).run();
        assert(d.enabled,409,'해제된 기기입니다.'); const b=await body();const mode=b.mode==='view'?'view':'control';
        const reusable=b.reusable===true;const id=random(12),secret=random(),expires=reusable?0:now+3600000;
        await sql('DELETE FROM invites WHERE device=? AND reusable=0 AND (expires<? OR used=1)',d.id,now).run();
        const count=await sql('SELECT COUNT(*) AS n FROM invites WHERE device=?',d.id).first<Row>();assert(count!.n<8,409,'초대가 너무 많습니다. 기존 초대를 취소해 주세요.');
        await sql('INSERT INTO invites (id,device,secret_hash,mode,expires,used,reusable) VALUES (?,?,?,?,?,0,?)',id,d.id,await hash(secret),mode,expires,reusable?1:0).run();
        return json({code:id+'.'+secret,expires,mode,reusable});
      }
      if(path[2]==='stop' && method==='POST') {
        await db!.batch([sql('DELETE FROM invites WHERE device=?',d.id),sql("UPDATE sessions SET status='ended',reason='맥 소유자가 접속 권한을 회수했습니다.',offer='',answer=NULL WHERE device=? AND status!='ended'",d.id)]);
        return json({ok:true});
      }
      if(path[2]==='decision' && method==='POST') {
        const b=await body();const s=await sql("SELECT * FROM sessions WHERE id=? AND device=? AND status='pending'",b.session,d.id).first<Row>();assert(s,409,'이미 처리된 요청입니다.');
        if(b.allow)await sql("UPDATE sessions SET status='approved' WHERE id=? AND status='pending'",s!.id).run();else await finish(s!,'맥 소유자가 요청을 거절했습니다.');return json({ok:true});
      }
      if(method==='DELETE' && path.length===2) {
        const ss=await sql('SELECT * FROM sessions WHERE device=?',d.id).all<Row>();for(const s of ss.results)await finish(s,'기기 연결이 해제되었습니다.');
        await db!.batch([sql('DELETE FROM invites WHERE device=?',d.id),sql('DELETE FROM sessions WHERE device=?',d.id),sql('DELETE FROM devices WHERE id=? AND owner=?',d.id,owner)]);return json({ok:true});
      }
    }
    if(path[0]==='ice' && path.length===1 && method==='POST') {
      const b=await body();assert(typeof b.code==='string'&&/^[a-f0-9]{24}\.[a-f0-9]{64}$/.test(b.code),400,'초대 링크 또는 코드를 확인해 주세요.');
      const [id,secret]=b.code.split('.');
      const invite=await sql('SELECT id,device FROM invites WHERE id=? AND secret_hash=? AND (reusable=1 OR (expires>? AND used=0))',id,await hash(secret),now).first<Row>();
      assert(invite,410,'초대가 만료되었거나 이미 사용되었습니다. 새 초대를 요청해 주세요.');
      const d=await sql('SELECT owner FROM devices WHERE id=? AND enabled=1',invite!.device).first<Row>();assert(d,410,'기기 접속 권한이 해제되었습니다.');
      await verifyHostEmail(invite!,d!,b.hostEmail);
      return json(await connectionIce(env,d!.owner,'invite:'+id));
    }
    if(path[0]==='join' && method==='POST') {
      const b=await body();assert(typeof b.code==='string' && /^[a-f0-9]{24}\.[a-f0-9]{64}$/.test(b.code),400,'초대 링크 또는 코드를 확인해 주세요.');
      assert(typeof b.offer==='string' && b.offer.length<100000 && b.offer.startsWith('v=0'),400,'화면 연결 요청을 생성하지 못했습니다.');
      const [iid,secret]=b.code.split('.'); const invite=await sql('SELECT * FROM invites WHERE id=? AND secret_hash=? AND (reusable=1 OR (expires>? AND used=0))',iid,await hash(secret),now).first<Row>();assert(invite,410,'초대가 만료되었거나 이미 사용되었습니다. 새 초대를 요청해 주세요.');
      const d=await sql('SELECT * FROM devices WHERE id=? AND enabled=1',invite!.device).first<Row>();assert(d,410,'기기 접속 권한이 해제되었습니다.');
      await verifyHostEmail(invite!,d!,b.hostEmail);
      assert(d!.seen>now-12000,409,'맥북 연결 프로그램이 오프라인입니다.');
      await cleanup(d!.id);
      const id=random(12),token=random(),status=invite!.reusable?'approved':'pending';
      const r=await sql("INSERT INTO sessions (id,device,invite,guest_hash,guest_name,mode,status,offer,created,expires,seen,generation) SELECT ?,?,?,?,?,?,?,?,?,0,?,0 WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE device=? AND status!='ended' AND seen>?) AND EXISTS (SELECT 1 FROM invites WHERE id=? AND (reusable=1 OR (used=0 AND expires>?)))",id,d!.id,iid,await hash(token),'Remote visitor',invite!.mode,status,b.offer,now,now,d!.id,now-20000,iid,now).run();
      assert(r.meta.changes===1,409,'다른 접속이 진행 중입니다. 기존 연결을 종료한 뒤 다시 시도해 주세요.');
      if(!invite!.reusable)await sql('UPDATE invites SET used=1 WHERE id=?',iid).run();
      const old=await sql("SELECT * FROM sessions WHERE device=? AND id!=? AND status='reconnecting'",d!.id,id).all<Row>();for(const prior of old.results)await finish(prior,'새 연결로 대체되었습니다.');
      return json({id,token,name:d!.name,mode:invite!.mode,status,expires:null,generation:0,reusable:!!invite!.reusable},201);
    }
    if(path[0]==='sessions' && path[1]) {
      const s=await guest(path[1]);
      if(path[2]==='ice'&&path.length===3&&method==='GET'){
        assert(s.status!=='ended',403,'종료된 연결입니다.');
        const d=await sql('SELECT owner FROM devices WHERE id=? AND enabled=1',s.device).first<Row>();assert(d,403,'기기 접속 권한이 해제되었습니다.');
        return json(await connectionIce(env,d!.owner,'session:'+s.id));
      }
      if(method==='GET' && path.length===2) {
        if(s.status!=='ended') await sql('UPDATE sessions SET seen=? WHERE id=?',now,s.id).run();
        const d=await sql('SELECT info FROM devices WHERE id=?',s.device).first<Row>();
        const info=JSON.parse(d?.info||'{}');
        return json({id:s.id,status:s.status,answer:s.answer,reason:s.reason,mode:s.mode,expires:null,generation:s.generation,quality:s.quality,qualityApplied:s.quality_applied,qualitySupported:info.qualityControl===true,connectorVersion:typeof info.version==='string'&&/^\d+\.\d+\.\d+$/.test(info.version)?info.version:null});
      }
      if(path[2]==='quality'&&method==='POST'){
        assert(['pending','approved','active'].includes(s.status),409,'연결을 복구한 뒤 화질을 변경해 주세요.');
        const b=await body();assert(isVideoQuality(b.quality),400,'지원하는 화질을 선택해 주세요.');assert(b.generation===s.generation,409,'이전 연결의 화질 요청입니다.');
        const d=await sql('SELECT info FROM devices WHERE id=?',s.device).first<Row>();assert(JSON.parse(d?.info||'{}').qualityControl===true,409,'맥북 연결 프로그램 1.2.0 이상으로 업데이트하면 화질을 선택할 수 있습니다.');
        const r=await sql("UPDATE sessions SET quality=?,quality_applied=NULL WHERE id=? AND generation=? AND status IN ('pending','approved','active')",b.quality,s.id,s.generation).run();assert(r.meta.changes===1,409,'연결 상태가 변경되었습니다.');
        return json({quality:b.quality,qualityApplied:null});
      }
      if(path[2]==='end' && method==='POST'){await finish(s,'접속자가 연결을 종료했습니다.');return json({ok:true});}
      if(path[2]==='resume' && method==='POST') {
        assert(['pending','approved','active','reconnecting'].includes(s.status),403,'종료된 연결은 복구할 수 없습니다.');
        const d=await sql('SELECT enabled,seen FROM devices WHERE id=?',s.device).first<Row>();assert(d?.enabled && d.seen>now-12000,409,'맥북이 온라인으로 돌아오기를 기다리고 있습니다.');
        const b=await body();assert(typeof b.offer==='string' && b.offer.startsWith('v=0') && b.offer.length<100000,400,'잘못된 연결 요청입니다.');
        if(s.offer===b.offer && s.status!=='reconnecting')return json({generation:s.generation,status:s.status});
        assert(Number.isInteger(b.generation) && b.generation===s.generation,409,'연결 상태가 변경되었습니다. 다시 동기화합니다.');
        const nextStatus=s.status==='pending'?'pending':'approved';
        const r=await sql("UPDATE sessions SET status=?,offer=?,answer=NULL,quality_applied=NULL,seen=?,reason=NULL,generation=generation+1 WHERE id=? AND generation=? AND status=? AND NOT EXISTS (SELECT 1 FROM sessions AS other WHERE other.device=? AND other.id!=? AND other.status!='ended' AND other.seen>?)",nextStatus,b.offer,now,s.id,s.generation,s.status,s.device,s.id,now-20000).run();
        assert(r.meta.changes===1,409,'다른 연결이 진행 중이거나 접속 권한이 변경되었습니다.');
        return json({generation:s.generation+1,status:nextStatus});
      }
    }
    if(path[0]==='agent' && path[1]) {
      const d=await agent(path[1]);
      const sessionReply=(s:Row|null)=>s?{id:s.id,name:s.guest_name,mode:s.mode,status:s.status,transport:s.transport,offer:s.answer?null:s.offer,expires:null,generation:s.generation,quality:s.quality}:null;
      if(path[2]==='check' && method==='GET') {
        // Read-only diagnostics must never make a stopped companion appear online.
        return json({ok:true,name:d.name,online:d.seen>now-12000,seen:d.seen,info:JSON.parse(d.info),requiredVersion:'1.2.0'});
      }
      if(path[2]==='poll' && method==='POST') {
        const b=await body();assert(JSON.stringify(b.info||{}).length<2000,400,'잘못된 기기 상태입니다.');
        const report=b.info?.quality;
        // These independent maintenance writes share one round trip. Unchanged
        // quality reports and older overlapping heartbeats do not rewrite rows.
        const maintenance:D1PreparedStatement[]=[];
        if(d.seen<now-3000||d.info!==JSON.stringify(b.info||{}))maintenance.push(sql('UPDATE devices SET seen=?,info=? WHERE id=? AND enabled=1 AND seen<?',now,JSON.stringify(b.info||{}),d.id,now));
        if(b.info?.qualityControl===true&&report&&typeof report.session==='string'&&Number.isInteger(report.generation)&&isVideoQuality(report.profile))maintenance.push(sql("UPDATE sessions SET quality_applied=? WHERE id=? AND device=? AND generation=? AND quality=? AND status='active' AND quality_applied IS NOT ?",report.profile,report.session,d.id,report.generation,report.profile,report.profile));
        if(maintenance.length)await db!.batch(maintenance);
        await cleanup(d.id);
        const s=await sql("SELECT * FROM sessions WHERE device=? AND status IN ('pending','approved','active') ORDER BY created DESC LIMIT 1",d.id).first<Row>();
        return json({session:sessionReply(s)});
      }
      const b=await body();
      const sid=b.session;
      const s=await sql("SELECT * FROM sessions WHERE id=? AND device=? AND status!='ended'",sid,d.id).first<Row>();assert(s && s.seen>now-20000,409,'세션이 종료되었습니다.');
      const generation=b.generation??0;
      if(['answer','recover','end'].includes(path[2]))assert(generation===s!.generation,409,'이전 연결의 응답은 폐기됩니다.');
      if(path[2]==='recover' && method==='POST'){await suspend(s!,'맥북 연결 프로그램에 다시 연결하고 있습니다.');return json({ok:true});}
      if(path[2]==='decision' && method==='POST') {
        if(b.allow)await sql("UPDATE sessions SET status='approved' WHERE id=? AND status='pending'",s!.id).run();else await finish(s!,'맥북에서 요청을 거절했습니다.');return json({ok:true});
      }
      if(path[2]==='answer' && method==='POST') {
        assert(s!.status==='approved',409,'먼저 연결을 승인해 주세요.');assert(typeof b.answer==='string' && b.answer.startsWith('v=0') && b.answer.length<100000,400,'잘못된 연결 응답입니다.');
        const r=await sql("UPDATE sessions SET answer=?,status='active' WHERE id=? AND status='approved' AND generation=?",b.answer,s!.id,s!.generation).run();assert(r.meta.changes===1,409,'연결 상태가 변경되어 응답을 폐기했습니다.');return json({ok:true});
      }
      if(path[2]==='end' && method==='POST'){await finish(s!,String(b.reason||'맥북에서 연결을 종료했습니다.').slice(0,150),true);return json({ok:true});}
    }
    return json({error:'요청한 경로가 없습니다.'},404);
  } catch(e) { if(e instanceof ApiError||e instanceof TurnError)return json({error:e.message},e.status);console.error('MacLink API failed', e instanceof Error?e.message:'unknown');return json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},500); }
}
