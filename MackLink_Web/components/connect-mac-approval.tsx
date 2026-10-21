'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,ShieldCheck,Laptop,LogIn,LoaderCircle,AlertCircle} from 'lucide-react';
import {LanguageSwitcher,useLocale} from '@/components/locale-provider';
import {approveEnrollment,enrollmentLoginPath,loadEnrollment,pendingEnrollmentExpired,validEnrollmentRequest,type EnrollmentRecord} from '@/lib/enrollment-client';

export function ConnectMacApproval(){
 const {locale,t}=useLocale();const localeRef=useRef(locale);localeRef.current=locale;
 const [requestId,setRequestId]=useState(''),[loading,setLoading]=useState(true),[signed,setSigned]=useState(false),[ownerId,setOwnerId]=useState(''),[email,setEmail]=useState(''),[record,setRecord]=useState<EnrollmentRecord|null>(null),[online,setOnline]=useState(false),[verificationCode,setVerificationCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 const owner=useRef(''),approvedAt=useRef(0),alive=useRef(true),refreshRef=useRef<()=>Promise<void>>(async()=>{});
 async function request(path:string,method='GET',body?:unknown){
  const response=await fetch('/api/'+path,{method,mode:'cors',credentials:'same-origin',headers:{'Accept-Language':localeRef.current,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(10000)});
  const data:any=await response.json();if(!response.ok)throw Object.assign(new Error(data?.error||'연결 요청을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'),{status:response.status});return data;
 }
 useEffect(()=>{
  alive.current=true;let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,inflight:Promise<void>|null=null;
  const values=new URLSearchParams(window.location.search).getAll('request');const id=values.length===1?values[0]:null;
  if(!validEnrollmentRequest(id)){setError('올바른 Mac 연결 링크가 아닙니다. 앱에서 다시 시작해 주세요.');setLoading(false);return()=>{alive.current=false;};}
  setRequestId(id);
  async function load(){let retry=true;try{
   const result=await loadEnrollment(request,id!);if(disposed)return;
   if(!result.signedIn){owner.current='';setSigned(false);setOwnerId('');setEmail('');setRecord(null);setOnline(false);setVerificationCode('');setError('');retry=false;return;}
   if(owner.current&&owner.current!==result.ownerId)setVerificationCode('');
   owner.current=result.ownerId;setSigned(true);setOwnerId(result.ownerId);setEmail(result.email);setRecord(result.enrollment);setOnline(result.online);setError('');
   if(result.enrollment.status==='approved'&&!approvedAt.current)approvedAt.current=Date.now();
   if(result.enrollment.status!=='pending')setVerificationCode('');
   retry=!result.online&&!['cancelled','expired'].includes(result.enrollment.status);
  }catch(e){if(disposed)return;const failure=e as Error&{status?:number};setOnline(false);setVerificationCode('');setError(failure.status===404?'연결 요청을 찾을 수 없습니다. 앱에서 Google 계정으로 연결을 다시 시작해 주세요.':failure.message);
   if([401,403,404].includes(failure.status||0)){setRecord(null);retry=false;}if(failure.status===401){owner.current='';setSigned(false);setOwnerId('');setEmail('');}
  }finally{if(!disposed){setLoading(false);if(retry)schedule();}}
  }
  function schedule(){timer=setTimeout(()=>{if(document.hidden)schedule();else void refresh();},4000);}
  function refresh(){if(disposed)return Promise.resolve();if(timer)clearTimeout(timer);if(inflight)return inflight;inflight=load().finally(()=>{inflight=null;});return inflight;}
  refreshRef.current=refresh;const focus=()=>void refresh();window.addEventListener('focus',focus);void refresh();const clock=setInterval(()=>setNow(Date.now()),1000);
  return()=>{disposed=true;alive.current=false;if(timer)clearTimeout(timer);clearInterval(clock);window.removeEventListener('focus',focus);};
 },[]);
 async function approve(){
  if(!record||record.status!=='pending'||!/^\d{6}$/.test(verificationCode)||pendingEnrollmentExpired(record)||busy)return;
  setBusy(true);setError('');try{await approveEnrollment(request,requestId,ownerId,verificationCode);if(alive.current){setVerificationCode('');await refreshRef.current();}}
  catch(e){if(!alive.current)return;setVerificationCode('');setError((e as Error).message);if((e as Error&{status?:number}).status===401){owner.current='';setSigned(false);setOwnerId('');setEmail('');setRecord(null);setOnline(false);}else{await refreshRef.current();if(alive.current)setError((e as Error).message);}}
  finally{if(alive.current)setBusy(false);}
 }
 const expired=record&&(record.status==='expired'||pendingEnrollmentExpired(record,now));
 const waiting=record?.status==='approved'&&!online;
 const remaining=record?Math.max(0,Math.ceil((record.expiresAt-now)/1000)):0;
 return <div className="enrollment-page"><header className="enrollment-header"><a className="brand" href="/" aria-label={t('MacLink 홈')}><img className="brand-mark" src="/maclink-icon.png" alt="" width={35} height={35}/>MacLink<span className="brand-dot">.</span></a><LanguageSwitcher/></header><main className="enrollment-card">
  <div className={'enrollment-symbol '+(online?'is-complete':'')}>{online?<Check size={30}/>:<Laptop size={30}/>}</div><span className="eyebrow">{t('MAC 연결')}</span><h1>{t(online?'Mac 연결이 완료되었습니다':waiting?'커넥터 연결 중':'내 Google 계정에 Mac 연결')}</h1>
  {loading?<div className="enrollment-loading" role="status"><LoaderCircle className="spin" size={22}/>{t('연결 요청을 확인하고 있습니다.')}</div>:<>
   {error&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{t(error)}</span></div>}
   {requestId&&!signed?<><p>{t('Mac을 등록할 Google 계정으로 로그인하세요. 로그인 후 커넥터에 표시된 확인 코드를 입력합니다.')}</p><a className="button button-green full" href={enrollmentLoginPath(requestId)} target="_top"><LogIn size={17}/>{t('로그인')}</a></>:record&&<>
    <div className="enrollment-device"><Laptop size={20}/><strong>{record.name}</strong></div><p className="enrollment-account">{t('연결할 계정')}<strong>{email}</strong></p>
    {expired?<div className="enrollment-notice"><h2>{t('연결 요청이 만료되었습니다')}</h2><p>{t('확인 코드는 10분 동안 유효합니다. MacLink 앱에서 Google 계정으로 연결을 다시 눌러 주세요.')}</p></div>:record.status==='cancelled'?<div className="enrollment-notice"><h2>{t('연결 요청이 취소되었습니다')}</h2><p>{t('MacLink 앱에서 Google 계정으로 연결을 다시 시작할 수 있습니다.')}</p></div>:record.status==='pending'?<>
     <p>{t('직접 시작한 MacLink 앱의 기기 이름을 확인하고, 커넥터에 표시된 확인 코드를 입력하세요.')}</p><label htmlFor="native-verification-code">{t('확인 코드')}</label><input className="enrollment-code" id="native-verification-code" type="text" inputMode="numeric" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={6} pattern="[0-9]{6}" value={verificationCode} disabled={busy} onChange={event=>setVerificationCode(event.target.value.replace(/[^0-9]/g,'').slice(0,6))} aria-describedby="enrollment-code-help"/><p id="enrollment-code-help" className="enrollment-expiry">{t('남은 시간 {minutes}분 {seconds}초',{minutes:Math.floor(remaining/60),seconds:remaining%60})}</p>
     <button className="button button-green full" disabled={!/^\d{6}$/.test(verificationCode)||busy} onClick={()=>void approve()}>{busy?<LoaderCircle size={17} className="spin"/>:<ShieldCheck size={17}/>} {t(busy?'연결 승인 중…':'이 Mac 연결')}</button><p className="enrollment-security">{t('직접 시작하지 않은 연결 요청은 승인하지 마세요. Mac은 현재 표시된 Google 계정에 등록됩니다.')}</p>
    </>:online?<><p>{t('커넥터가 서버에 연결되어 내 기기에 온라인으로 표시됩니다. 다른 컴퓨터에서도 같은 Google 계정으로 로그인해 원격 접속하세요.')}</p><a className="button button-green full" href="/">{t('내 기기로 이동')}<ArrowRight size={17}/></a></>:<><div className="enrollment-loading" role="status"><LoaderCircle className="spin" size={22}/>{t('앱이 연결될 때까지 잠시 기다려 주세요.')}</div><p>{t('브라우저 승인은 완료되었습니다. MacLink 앱을 열어 둔 상태에서 실제 서버 연결을 확인하고 있습니다.')}</p>{approvedAt.current&&now-approvedAt.current>60000?<p className="enrollment-notice">{t('아직 커넥터가 연결되지 않았습니다. Mac에서 MacLink 앱과 인터넷 연결을 확인하고 Google 계정으로 연결을 다시 진행해 주세요.')}</p>:null}<button className="text-button" onClick={()=>void refreshRef.current()}>{t('연결 상태 다시 확인')}</button><a className="button button-white full" href="/">{t('내 기기로 이동')}<ArrowRight size={17}/></a></>}
   </>}
   {(!record||expired||record.status==='cancelled')&&<a className="enrollment-home" href="/">{t('MacLink 홈으로')}</a>}
  </>}
 </main><footer className="enrollment-footer"><a href="/privacy">{t('개인정보 처리방침')}</a><a href="/terms">{t('서비스 약관')}</a></footer></div>;
}
