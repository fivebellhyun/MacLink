/** Accept complete capability codes, including copies from messages and encoded URLs. */
export function parseInviteCode(value:unknown):string|null {
 if(typeof value!=='string'||value.length>8192)return null;
 let normalized=value.normalize('NFKC');
 for(let i=0;i<3;i++){
  try{const decoded=decodeURIComponent(normalized);if(decoded===normalized)break;normalized=decoded;}catch{break;}
 }
 normalized=normalized.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g,'').toLowerCase();
 const matches=[...normalized.matchAll(/(?:^|[^a-f0-9])([a-f0-9]{24}\.[a-f0-9]{64})(?![a-f0-9])/g)].map(m=>m[1]);
 const unique=[...new Set(matches)];
 return unique.length===1?unique[0]:null;
}

export function inviteError(value:string):string {
 if(!value.trim())return '초대 링크를 열거나 전달받은 접속 코드를 입력해 주세요.';
 if(/https?:\/\//i.test(value)&&!/[.#?](?:join=)?[a-f0-9]{8}/i.test(value))return '접속 코드가 없는 기본 주소입니다. 소유자가 발급한 초대 링크 또는 접속 코드를 받아 주세요.';
 return '접속 코드가 잘렸거나 여러 개 포함되어 있습니다. 소유자의 ‘초대 링크 복사’ 또는 ‘접속 코드 복사’로 받은 내용을 붙여넣어 주세요.';
}
