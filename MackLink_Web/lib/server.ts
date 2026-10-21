import {handleEnrollment} from './enrollment.ts';
import {connectionIce,turnStatus,saveTurn,removeTurn,TurnError,type TurnBindings} from './turn.ts';
import {DEFAULT_VIDEO_QUALITY,isVideoQuality} from './quality.ts';
import {localizeApiPayload,negotiateLocale} from './i18n-api.ts';
import {getGoogleSession,type GoogleAuthBindings} from './google-auth.ts';
type Bindings = TurnBindings & GoogleAuthBindings;
type Row = Record<string, any>;
class ApiError extends Error { status:number; constructor(status: number, message: string) { super(message); this.status=status; } }
const assert = (ok: unknown, status: number, message: string): void => { if (!ok) throw new ApiError(status, message); };
const random = (n=32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), v=>v.toString(16).padStart(2,'0')).join('');
export async function hash(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join(''); }
export async function handleApi(req: Request, env: Bindings): Promise<Response> {
  const locale=negotiateLocale(req.headers.get('Accept-Language'));
  const json=(data:unknown,status=200)=>Response.json(localizeApiPayload(data,locale),{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Language':locale,'Vary':'Accept-Language'}});
  try {
    const path = new URL(req.url).pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);
    const method=req.method, now=Date.now(), db=env.DB;
    if(path[0]==='enrollment')return handleEnrollment(req,env);
    if((path[0]==='agent'&&(path.length!==3||!['check','poll','answer','recover','end'].includes(path[2])))||(path[0]==='sessions'&&path.length>2&&(path.length!==3||!['ice','quality','end','resume'].includes(path[2]))))return json({error:'요청한 경로가 없습니다.'},404);
    if(path[0]==='devices' && path.length>2 && (path.length!==3||!['ice','connect','stop'].includes(path[2])))return json({error:'요청한 경로가 없습니다.'},404);
    // Browser access always uses the live Google session; connector traffic
    // remains authenticated by its per-device key.
    const user=['me','devices','network','sessions'].includes(path[0])?await getGoogleSession(req,env):null;
    const owner=user?.userId??null;
    const auth=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? '';
    if (method !== 'GET' && req.headers.has('Origin')) assert(req.headers.get('Origin')===new URL(req.url).origin,403,'다른 사이트의 요청은 허용하지 않습니다.');
    if (path[0] === 'me' && method==='GET') return json({signedIn:!!owner,email:user?.email??null,ownerId:owner});
    assert(db,503,'저장소가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    const sql=(q:string,...args:any[])=>db!.prepare(q).bind(...args);
    const body=async()=>{ assert(Number(req.headers.get('Content-Length')||0)<=160000,413,'요청이 너무 큽니다.'); const raw=await req.text();assert(raw.length<=160000,413,'요청이 너무 큽니다.');try{return JSON.parse(raw);}catch{throw new ApiError(400,'올바르지 않은 요청입니다.');} };
    const requireOwner=()=>{
      assert(owner,401,'내 기기에 접속하려면 Google로 로그인해 주세요.');
      assert(req.headers.get('sec-fetch-site')!=='cross-site',403,'다른 사이트의 요청은 허용하지 않습니다.');
      if(method!=='GET')assert(req.headers.get('Origin')===new URL(req.url).origin,403,'다른 사이트의 요청은 허용하지 않습니다.');
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
    const expireLease=async(s:Row,reason:string,checkDevice=false)=>{const r=await sql("UPDATE sessions SET status='reconnecting',reason=?,offer='',answer=NULL WHERE id=? AND generation=? AND status IN ('approved','active') AND (seen<?"+(checkDevice?" OR EXISTS (SELECT 1 FROM devices WHERE devices.id=sessions.device AND enabled=1 AND seen<?)":"")+")",reason,s.id,s.generation,now-20000,...(checkDevice?[now-15000]:[])).run();return !!r.meta.changes;};
    const cleanup=async(device:string)=>{const stale=await sql("SELECT * FROM sessions WHERE device=? AND status IN ('approved','active') AND seen<?",device,now-20000).all<Row>();for(const s of stale.results)await expireLease(s,'네트워크 복구를 기다리고 있습니다.');};
    const liveAuthorization="EXISTS (SELECT 1 FROM auth_sessions AS login JOIN devices AS host ON host.id=sessions.device WHERE login.token_hash=sessions.auth_session_hash AND login.user_id=sessions.owner AND login.expires>? AND host.owner=sessions.owner AND host.enabled=1)";
    const revokeExpired=async(device:string)=>{await sql("UPDATE sessions SET status='ended',reason='로그인이 종료되었습니다. 다시 로그인해 주세요.',offer='',answer=NULL,generation=generation+1 WHERE device=? AND status!='ended' AND NOT "+liveAuthorization,device,now).run();};
    const browserSession=async(id:string)=>{
      requireOwner();assert(auth,401,'세션 키가 필요합니다.');
      const sessionHash=await hash(auth);
      let s=await sql('SELECT sessions.* FROM sessions JOIN devices ON devices.id=sessions.device WHERE sessions.id=? AND sessions.guest_hash=? AND sessions.owner=? AND sessions.auth_session_hash=? AND devices.owner=?',id,sessionHash,owner,user!.sessionHash,owner).first<Row>();
      assert(s,404,'세션을 찾을 수 없습니다.');
      if(s!.status!=='ended') {
        const d=await sql('SELECT enabled,seen FROM devices WHERE id=?',s!.device).first<Row>();
        if(!d?.enabled){await finish(s!,'기기 접속 권한이 해제되었습니다.');s!.status='ended';}
        else if(s!.seen<now-20000 || d.seen<now-15000){await expireLease(s!,'맥북 또는 네트워크 복구를 기다리고 있습니다.',true);s=await sql('SELECT * FROM sessions WHERE id=?',id).first<Row>();assert(s,404,'세션을 찾을 수 없습니다.');}
      }
      return s!;
    };
    if (path[0] === 'devices' && path.length === 1) {
      requireOwner();
      if(method==='GET') {
        const ds=await sql('SELECT id,name,seen,enabled,info,created FROM devices WHERE owner=? ORDER BY created DESC',owner).all<Row>();
        for(const d of ds.results){await revokeExpired(d.id);await cleanup(d.id);d.info=JSON.parse(d.info);d.online=!!d.enabled&&d.seen>now-12000;d.setupState=d.online?'online':d.seen===0?'awaiting-connector':'offline';d.sessions=(await sql('SELECT id,guest_name,mode,status,created,reason FROM sessions WHERE device=? ORDER BY created DESC LIMIT 6',d.id).all()).results;}
        return json({devices:ds.results});
      }
      if(method==='POST') {
        const b=await body();assert(b && typeof b.name==='string' && b.name.trim().length>0 && b.name.length<=60,400,'기기 이름은 1~60자로 입력해 주세요.');
        const id=random(12),token=random();const registered=await sql('INSERT INTO devices (id,owner,name,agent_hash,created,seen,enabled,info) SELECT ?,?,?,?,?,0,1,? WHERE (SELECT COUNT(*) FROM devices WHERE owner=?)<8',id,owner,b.name.trim(),await hash(token),now,'{}',owner).run();assert(registered.meta.changes===1,409,'최대 8대까지 등록할 수 있습니다.');
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
      // Each statement uses the same compare-and-swap guard. A competing claim
      // cannot revoke the winner's new sessions. Ownership moves
      // last, in this atomic batch; the connector secret itself is unchanged.
      const guard='EXISTS (SELECT 1 FROM devices WHERE id=? AND owner=? AND agent_hash=? AND enabled=1 AND owner NOT LIKE \'google:%\') AND (SELECT COUNT(*) FROM devices WHERE owner=?)<8';
      const guardArgs=[d!.id,d!.owner,keyHash,owner];
      const result=await db!.batch([
        sql("UPDATE sessions SET status='ended',reason='기기 소유 계정이 변경되었습니다.',offer='',answer=NULL,generation=generation+1 WHERE device=? AND "+guard,d!.id,...guardArgs),
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
      if(path[2]==='ice' && path.length===3 && method==='GET') {
        assert(d.enabled,409,'해제된 기기입니다.');
        return json(await connectionIce(env,owner!,'device:'+d.id));
      }
      if(path[2]==='connect' && path.length===3 && method==='POST') {
        assert(d.enabled,409,'해제된 기기입니다.');
        const b=await body();
        assert(b && typeof b==='object' && typeof b.offer==='string' && b.offer.startsWith('v=0') && b.offer.length<100000,400,'화면 연결 요청을 생성하지 못했습니다.');
        const mode=b.mode??'control';assert(mode==='view'||mode==='control',400,'지원하는 연결 방식을 선택해 주세요.');
        assert(b.connectionMode===undefined||b.connectionMode==='auto'||b.connectionMode==='tls',400,'지원하는 연결 방식을 선택해 주세요.');
        assert(d.seen>now-12000,409,'맥북 연결 프로그램이 오프라인입니다.');
        await revokeExpired(d.id);await cleanup(d.id);
        const id=random(12),token=random();
        // Authorization and the one-connection limit are checked again inside
        // the insert so logout, ownership changes and parallel requests cannot
        // create a session from a stale authorization snapshot.
        const r=await sql("INSERT INTO sessions (id,device,owner,auth_session_hash,guest_hash,guest_name,mode,status,offer,created,expires,seen,generation,quality) SELECT ?,?,?,?,?,?,?,'approved',?,?,0,?,0,? WHERE EXISTS (SELECT 1 FROM devices WHERE id=? AND owner=? AND enabled=1 AND seen>?) AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires>?) AND NOT EXISTS (SELECT 1 FROM sessions WHERE device=? AND status!='ended' AND seen>?)",id,d.id,owner,user!.sessionHash,await hash(token),'Device owner',mode,b.offer,now,now,DEFAULT_VIDEO_QUALITY,d.id,owner,now-12000,user!.sessionHash,owner,now,d.id,now-20000).run();
        assert(r.meta.changes===1,409,'다른 접속이 진행 중입니다. 기존 연결을 종료한 뒤 다시 시도해 주세요.');
        const old=await sql("SELECT * FROM sessions WHERE device=? AND id!=? AND status='reconnecting'",d.id,id).all<Row>();for(const prior of old.results)await finish(prior,'새 연결로 대체되었습니다.');
        return json({id,token,name:d.name,deviceId:d.id,ownerId:owner,mode,status:'approved',expires:null,generation:0},201);
      }
      if(path[2]==='stop' && path.length===3 && method==='POST') {
        await sql("UPDATE sessions SET status='ended',reason='맥 소유자가 접속 권한을 회수했습니다.',offer='',answer=NULL,generation=generation+1 WHERE device=? AND status!='ended'",d.id).run();
        return json({ok:true});
      }
      if(method==='DELETE' && path.length===2) {
        const ss=await sql('SELECT * FROM sessions WHERE device=?',d.id).all<Row>();for(const s of ss.results)await finish(s,'기기 연결이 해제되었습니다.');
        await db!.batch([sql('DELETE FROM sessions WHERE device=?',d.id),sql('DELETE FROM devices WHERE id=? AND owner=?',d.id,owner)]);return json({ok:true});
      }
    }
    if(path[0]==='sessions' && path[1]) {
      let s=await browserSession(path[1]);
      if(path[2]==='ice'&&path.length===3&&method==='GET'){
        assert(s.status!=='ended',403,'종료된 연결입니다.');
        const d=await sql('SELECT owner FROM devices WHERE id=? AND enabled=1',s.device).first<Row>();assert(d,403,'기기 접속 권한이 해제되었습니다.');
        return json(await connectionIce(env,d!.owner,'session:'+s.id));
      }
      if(method==='GET' && path.length===2) {
        if(s.status!=='ended') {
          await sql("UPDATE sessions SET seen=? WHERE id=? AND status!='ended' AND "+liveAuthorization,now,s.id,now).run();
          s=(await sql('SELECT * FROM sessions WHERE id=?',s.id).first<Row>())!;
          assert(s,404,'세션을 찾을 수 없습니다.');
        }
        const d=await sql('SELECT info FROM devices WHERE id=?',s.device).first<Row>();
        const info=JSON.parse(d?.info||'{}');
        return json({id:s.id,status:s.status,answer:s.answer,reason:s.reason,mode:s.mode,expires:null,generation:s.generation,quality:s.quality,qualityApplied:s.quality_applied,qualitySupported:info.qualityControl===true,audioSupported:info.audioSupported===true,audioAvailable:info.audioAvailable===true,audioError:['permission','unavailable','capture-failed'].includes(info.audioError)?info.audioError:null,connectorVersion:typeof info.version==='string'&&/^\d+\.\d+\.\d+$/.test(info.version)?info.version:null});
      }
      if(path[2]==='quality'&&method==='POST'){
        assert(['approved','active'].includes(s.status),409,'연결을 복구한 뒤 화질을 변경해 주세요.');
        const b=await body();assert(isVideoQuality(b.quality),400,'지원하는 화질을 선택해 주세요.');assert(b.generation===s.generation,409,'이전 연결의 화질 요청입니다.');
        const d=await sql('SELECT info FROM devices WHERE id=?',s.device).first<Row>();assert(JSON.parse(d?.info||'{}').qualityControl===true,409,'맥북 연결 프로그램 1.2.0 이상으로 업데이트하면 화질을 선택할 수 있습니다.');
        const r=await sql("UPDATE sessions SET quality=?,quality_applied=NULL WHERE id=? AND generation=? AND status IN ('approved','active')",b.quality,s.id,s.generation).run();assert(r.meta.changes===1,409,'연결 상태가 변경되었습니다.');
        return json({quality:b.quality,qualityApplied:null});
      }
      if(path[2]==='end' && method==='POST'){await finish(s,'접속자가 연결을 종료했습니다.');return json({ok:true});}
      if(path[2]==='resume' && method==='POST') {
        assert(['approved','active','reconnecting'].includes(s.status),403,'종료된 연결은 복구할 수 없습니다.');
        const d=await sql('SELECT enabled,seen FROM devices WHERE id=?',s.device).first<Row>();assert(d?.enabled && d.seen>now-12000,409,'맥북이 온라인으로 돌아오기를 기다리고 있습니다.');
        const b=await body();assert(typeof b.offer==='string' && b.offer.startsWith('v=0') && b.offer.length<100000,400,'잘못된 연결 요청입니다.');
        if(s.offer===b.offer && s.status!=='reconnecting')return json({generation:s.generation,status:s.status});
        assert(Number.isInteger(b.generation) && b.generation===s.generation,409,'연결 상태가 변경되었습니다. 다시 동기화합니다.');
        const nextStatus='approved';
        const r=await sql("UPDATE sessions SET status=?,offer=?,answer=NULL,quality_applied=NULL,seen=?,reason=NULL,generation=generation+1 WHERE id=? AND generation=? AND status=? AND "+liveAuthorization+" AND NOT EXISTS (SELECT 1 FROM sessions AS other WHERE other.device=? AND other.id!=? AND other.status!='ended' AND other.seen>?)",nextStatus,b.offer,now,s.id,s.generation,s.status,now,s.device,s.id,now-20000).run();
        assert(r.meta.changes===1,409,'다른 연결이 진행 중이거나 접속 권한이 변경되었습니다.');
        return json({generation:s.generation+1,status:nextStatus});
      }
    }
    if(path[0]==='agent' && path[1]) {
      const d=await agent(path[1]);
      const sessionReply=(s:Row|null)=>s?{id:s.id,name:s.guest_name,mode:s.mode,status:s.status,offer:s.answer?null:s.offer,expires:null,generation:s.generation,quality:s.quality}:null;
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
        await revokeExpired(d.id);await cleanup(d.id);
        const s=await sql("SELECT * FROM sessions WHERE device=? AND status IN ('approved','active') ORDER BY created DESC LIMIT 1",d.id).first<Row>();
        return json({session:sessionReply(s)});
      }
      const b=await body();
      const sid=b.session;
      await revokeExpired(d.id);
      const s=await sql("SELECT * FROM sessions WHERE id=? AND device=? AND status!='ended'",sid,d.id).first<Row>();assert(s && s.seen>now-20000,409,'세션이 종료되었습니다.');
      const generation=b.generation??0;
      if(['answer','recover','end'].includes(path[2]))assert(generation===s!.generation,409,'이전 연결의 응답은 폐기됩니다.');
      if(path[2]==='recover' && method==='POST'){await suspend(s!,'맥북 연결 프로그램에 다시 연결하고 있습니다.');return json({ok:true});}
      if(path[2]==='answer' && method==='POST') {
        assert(s!.status==='approved',409,'연결 상태가 변경되었습니다.');assert(typeof b.answer==='string' && b.answer.startsWith('v=0') && b.answer.length<100000,400,'잘못된 연결 응답입니다.');
        const r=await sql("UPDATE sessions SET answer=?,status='active' WHERE id=? AND status='approved' AND generation=? AND "+liveAuthorization,b.answer,s!.id,s!.generation,now).run();assert(r.meta.changes===1,409,'연결 상태가 변경되어 응답을 폐기했습니다.');return json({ok:true});
      }
      if(path[2]==='end' && method==='POST'){await finish(s!,String(b.reason||'맥북에서 연결을 종료했습니다.').slice(0,150),true);return json({ok:true});}
    }
    return json({error:'요청한 경로가 없습니다.'},404);
  } catch(e) { if(e instanceof ApiError||e instanceof TurnError)return json({error:e.message},e.status);console.error('MacLink API failed', e instanceof Error?e.message:'unknown');return json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},500); }
}
