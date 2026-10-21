export type EnrollmentStatus='pending'|'approved'|'cancelled'|'expired';
export type EnrollmentRecord={id:string;name:string;status:EnrollmentStatus;expiresAt:number;deviceId?:string};
export type EnrollmentRequest=(path:string,method?:string,body?:unknown)=>Promise<any>;
export type EnrollmentSnapshot={signedIn:false}|{signedIn:true;ownerId:string;email:string;enrollment:EnrollmentRecord;online:boolean};
export function validEnrollmentRequest(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);}
export function enrollmentLoginPath(id:string){return '/auth/google?return_to='+encodeURIComponent('/connect-mac?request='+id);}
export function pendingEnrollmentExpired(record:EnrollmentRecord,now=Date.now()){return record.status==='pending'&&now>=record.expiresAt;}
export async function loadEnrollment(request:EnrollmentRequest,id:string):Promise<EnrollmentSnapshot>{
 if(!validEnrollmentRequest(id))throw new Error('올바른 Mac 연결 링크가 아닙니다. 앱에서 다시 시작해 주세요.');
 const me=await request('me');
 if(me.signedIn!==true||typeof me.ownerId!=='string'||!me.ownerId)return{signedIn:false};
 const record=await request('enrollment/'+id) as EnrollmentRecord;
 if(!record||record.id!==id||typeof record.name!=='string'||!['pending','approved','cancelled','expired'].includes(record.status)||!Number.isFinite(record.expiresAt)||(record.status==='approved'&&!validEnrollmentRequest(record.deviceId)))throw new Error('연결 요청을 확인하지 못했습니다. 앱에서 다시 시작해 주세요.');
 let online=false;
 if(record.status==='approved'){
  const result=await request('devices');
  online=Array.isArray(result.devices)&&result.devices.some((device:any)=>device.id===record.deviceId&&device.online===true&&typeof device.seen==='number'&&device.seen>0);
 }
 return{signedIn:true,ownerId:me.ownerId,email:typeof me.email==='string'?me.email:'',enrollment:record,online};
}
export async function approveEnrollment(request:EnrollmentRequest,id:string,ownerId:string,verificationCode:string){
 if(!validEnrollmentRequest(id)||!/^\d{6}$/.test(verificationCode))throw new Error('연결 요청을 확인하지 못했습니다. 앱에서 다시 시작해 주세요.');
 const me=await request('me');
 if(me.signedIn!==true)throw Object.assign(new Error('Mac을 연결하려면 Google로 로그인해 주세요.'),{status:401});
 if(me.ownerId!==ownerId)throw Object.assign(new Error('로그인 계정이 변경되었습니다. 계정을 확인한 뒤 다시 승인해 주세요.'),{status:409});
 return request('enrollment/'+id+'/approve','POST',{verificationCode,expectedOwnerId:ownerId});
}
