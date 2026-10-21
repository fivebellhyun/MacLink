export const QUALITY_PROFILES=[
 {id:'low',label:'빠르게',width:1600,height:null,fps:15,targetMbps:2,maxMbps:4},
 {id:'balanced',label:'중간',width:1600,height:null,fps:24,targetMbps:4,maxMbps:8},
 {id:'high',label:'선명하게',width:2560,height:null,fps:30,targetMbps:8,maxMbps:16},
 {id:'ultra',label:'최고',width:2560,height:null,fps:60,targetMbps:16,maxMbps:40},
] as const;
export type VideoQuality=typeof QUALITY_PROFILES[number]['id'];
export const DEFAULT_VIDEO_QUALITY:VideoQuality='ultra';
export function isVideoQuality(value:unknown):value is VideoQuality{return QUALITY_PROFILES.some(p=>p.id===value);}

export function qualityProfileLabel(profile:typeof QUALITY_PROFILES[number],translate:(message:string)=>string):string{
 return `${translate(profile.label)} · ${profile.width}px / ${profile.fps}fps`;
}

export function qualityProfileDescription(profile:typeof QUALITY_PROFILES[number],translate:(message:string,params?:Record<string,string|number>)=>string):string{
 const bitrate=translate('WebRTC 영상 설정 목표 {target} Mbps · 상한 {max} Mbps. 실측값이 아니며 네트워크 상태에 따라 낮아질 수 있습니다.',{target:profile.targetMbps,max:profile.maxMbps});
 const bandwidth=profile.id==='ultra'?' '+translate('최고 화질은 2560px / 60fps를 목표로 하며 빠르고 안정적인 네트워크가 필요합니다. 실제 프레임 수는 Mac 성능과 연결 상태에 따라 달라집니다.'):'';
 const sound=profile.id==='ultra'?' '+translate('지원되는 브라우저에서 소리 버튼을 누르면 48kHz 스테레오 PCM을 사용할 수 있습니다. 소리 전송량은 약 3.1 Mbps이며, 사용할 수 없으면 Opus로 재생합니다.'):'';
 return bitrate+bandwidth+sound;
}
