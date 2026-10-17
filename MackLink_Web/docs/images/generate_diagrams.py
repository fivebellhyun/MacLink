"""Rebuild original MacLink diagrams with Python 3 and Inkscape.
Requires DejaVu Sans and NanumGothic fonts. Outputs SVG paths and PNGs.
Copyright (c) 2026 fivebellhyun; see ../../LICENSE.
"""
from pathlib import Path
from html import escape
import subprocess
import tempfile

OUT = Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
_temp_dir = tempfile.TemporaryDirectory(prefix='maclink-diagrams-')
TMP = Path(_temp_dir.name)
W=1760
C={'bg':'#F6F7F2','ink':'#1D3830','muted':'#617469','green':'#087A59','light':'#EAF2E5','border':'#D9E2D7','white':'#FFFFFF','line':'#8AA58C','amber':'#986536','pale':'#F7F0E7','blue':'#EAF0F4'}

class SVG:
 def __init__(self,h,lang,title,desc):
  self.h,self.lang=h,lang
  self.font='NanumGothic' if lang=='ko' else 'DejaVu Sans'
  self.s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{h}" viewBox="0 0 {W} {h}" role="img" aria-labelledby="title desc">',f'<title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc>',f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="{C["line"]}"/></marker><marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="{C["green"]}"/></marker></defs>']
  self.rect(0,0,W,h,0,C['bg'],None)
 def rect(self,x,y,w,h,r=24,fill=None,stroke=None):
  self.s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or C["white"]}"'+(f' stroke="{stroke}" stroke-width="2"' if stroke else '')+'/>')
 def text(self,x,y,t,size=24,fill=None,weight=400,anchor='start'):
  self.s.append(f'<text x="{x}" y="{y}" fill="{fill or C["ink"]}" font-family="{self.font},sans-serif" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{escape(t)}</text>')
 def lines(self,x,y,ls,size=24,gap=38,fill=None,weight=400):
  for i,t in enumerate(ls):self.text(x,y+i*gap,t,size,fill,weight)
 def path(self,d,color=None,width=3,arrow=True,dashed=False,both=False):
  col=color or C['line'];marker='arrowGreen' if col==C['green'] else 'arrow'
  self.s.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'+(f' marker-end="url(#{marker})"' if arrow else '')+(f' marker-start="url(#{marker})"' if both else '')+(' stroke-dasharray="9 8"' if dashed else '')+'/>')
 def badge(self,x,y,t,fill=None,ink=None,w=74):
  self.rect(x,y,w,42,21,fill or C['light'])
  self.text(x+w/2,y+29,t,19,ink or C['green'],700,'middle')
 def header(self,eyebrow,title,sub):
  self.text(80,70,eyebrow,19,C['green'],700)
  self.text(80,134,title,46,weight=700)
  self.text(80,183,sub,24,C['muted'])
 def footer(self,n):
  y=self.h-64
  self.path(f'M 80 {y-30} H 1680',C['border'],2,False)
  self.text(80,y+5,'MacLink · fivebellhyun · 1.3.2',18,C['muted'])
  self.text(1680,y+5,('구조도' if self.lang=='ko' else 'Schematic')+f'  /  {n:02d}',18,C['muted'],anchor='end')
 def browser_icon(self,x,y,color=None):
  color=color or C['green']
  self.rect(x,y,68,48,8,'none',color)
  self.path(f'M {x} {y+14} H {x+68}',color,2,False)
  for k in range(3): self.s.append(f'<circle cx="{x+9+k*9}" cy="{y+7}" r="2" fill="{color}"/>')
 def laptop_icon(self,x,y,color=None):
  color=color or C['green']
  self.rect(x+7,y,54,39,5,'none',color)
  self.path(f'M {x+7} {y+39} L {x} {y+49} H {x+68} L {x+61} {y+39}',color,3,False)
 def cloud_icon(self,x,y,color=None):
  color=color or C['green']
  self.path(f'M {x+12} {y+42} C {x-8} {y+37} {x-1} {y+15} {x+17} {y+18} C {x+22} {y-4} {x+54} {y-4} {x+58} {y+19} C {x+81} {y+17} {x+86} {y+45} {x+65} {y+45} H {x+12}',color,3,False)
 def save(self,name):
  self.s.append('</svg>')
  tmp=TMP/(name+'-text.svg');tmp.write_text('\n'.join(self.s))
  svg=OUT/(name+'.svg');png=OUT/(name+'.png')
  # Keep precise vector paths in the distribution; source text is in the build script.
  subprocess.run(['inkscape',str(tmp),'--export-text-to-path','--export-plain-svg',f'--export-filename={svg}'],check=True,capture_output=True)
  subprocess.run(['inkscape',str(svg),f'--export-filename={png}','--export-width=1760'],check=True,capture_output=True)
  print(name, W,self.h,svg.stat().st_size,png.stat().st_size)

def architecture(lang):
 ko=lang=='ko'
 d=SVG(1190,lang,'MacLink architecture' if not ko else 'MacLink 시스템 구조','MacLink browser, coordination API and Mac Connector, with encrypted direct WebRTC or optional TURN transport.')
 d.header('SYSTEM ARCHITECTURE' if not ko else '시스템 구조', 'One link. Encrypted WebRTC.' if not ko else '링크 하나로 연결하는 암호화된 WebRTC.', 'The website coordinates access. Screen and input use direct WebRTC or optional TURN.' if not ko else '웹사이트가 접속을 조정하고, 화면과 입력은 직접 WebRTC 또는 선택적 TURN으로 전송합니다.')
 xs=[80,650,1220];w=460
 for x in xs:d.rect(x,240,w,330,26,C['white'],C['border'])
 d.browser_icon(114,272);d.cloud_icon(684,272);d.laptop_icon(1254,272)
 d.text(114,367,'Remote browser' if not ko else '원격 사용자 브라우저',29,weight=700)
 d.lines(114,415,['Opens an access link','Displays screen / sends input','No viewer app installation'] if not ko else ['접속 링크 열기','화면 표시 / 키보드·마우스 입력','별도 뷰어 프로그램 설치 불필요'],23,40,C['muted'])
 d.text(684,367,'www.maclink.cloud',29,weight=700)
 d.lines(684,415,['Google sign-in + signalling','Authorization checks every 4s','D1: accounts, devices, sessions'] if not ko else ['Google 로그인 · 연결 정보 교환','4초 간격 접속 권한 확인','D1: 계정 · 기기 · 세션'],22,40,C['muted'])
 d.text(1254,367,'Mac + Connector',27,weight=700)
 d.lines(1254,415,['Native macOS menu bar app','Screen capture + native input','Screen Recording + Device control'] if not ko else ['macOS 메뉴 막대 앱','화면 캡처 + macOS 입력 실행','화면 기록 · 기기 제어 권한'],22,40,C['muted'])
 d.path('M 540 348 H 650',both=True)
 d.path('M 1110 348 H 1220',both=True)
 d.text(595,320,'HTTPS',17,C['muted'],anchor='middle');d.text(1165,320,'HTTPS',17,C['muted'],anchor='middle')
 d.text(80,626,'SCREEN + INPUT TRANSPORTS' if not ko else '화면과 입력의 전송 경로',20,C['green'],700)
 rows=[(656,152),(830,204)]
 for y,h in rows:d.rect(80,y,1600,h,24,C['white'],C['border'])
 d.badge(110,684,'01');d.text(210,702,'Direct WebRTC' if not ko else 'WebRTC 직접 연결',29,weight=700)
 d.text(210,750,'Encrypted video + input data channel' if not ko else '암호화된 영상 + 입력 데이터 채널',23,C['muted'])
 d.text(910,719,'Browser' if not ko else '브라우저',25,weight=700,anchor='middle')
 d.text(1510,719,'Mac',25,weight=700,anchor='middle')
 d.path('M 1020 710 H 1390',C['green'],4,both=True)
 d.text(1205,754,'Peer-to-peer' if not ko else '기기 간 직접 연결',18,C['muted'],anchor='middle')
 d.badge(110,858,'02');d.text(210,876,'TURN relay · optional' if not ko else 'TURN 중계 · 선택 사항',29,weight=700)
 d.lines(210,923,['Encrypted WebRTC packets','Cloudflare TURN credentials required'] if not ko else ['암호화된 WebRTC 패킷 전송','Cloudflare TURN 키 등록 필요'],22,37,C['muted'])
 for x,t in [(870,'Browser' if not ko else '브라우저'),(1160,'TURN'),(1510,'Mac')]:d.text(x,904,t,24,weight=700,anchor='middle')
 d.path('M 968 895 H 1082',C['green'],3,both=True);d.path('M 1240 895 H 1390',C['green'],3,both=True)
 d.text(1160,953,'Viewer allocates relay; Mac keeps its STUN / UDP path.' if not ko else '중계 할당은 브라우저에서 수행 · Mac은 STUN / UDP 경로 사용',17,C['muted'],anchor='middle')
 d.text(1160,983,'The Connector does not allocate its own TURN relay.' if not ko else 'Connector 자체의 TURN 중계 할당은 구현되어 있지 않음',17,C['muted'],anchor='middle')
 d.footer(1);d.save('architecture-'+lang)

def connection_paths(lang):
 ko=lang=='ko'
 d=SVG(1220,lang,'MacLink connection selection' if not ko else 'MacLink 연결 경로 선택','Automatic WebRTC selection, one optional TURN TLS-only retry, then a connection failure notice if no route works.')
 d.header('CONNECTION PATHS' if not ko else '연결 경로', 'Connect with WebRTC, directly or via TURN.' if not ko else 'WebRTC로 직접 연결하거나 TURN을 사용합니다.', 'Automatic mode selects an available route; connection success depends on network policy.' if not ko else '자동 모드는 사용 가능한 경로를 선택하며, 연결 성공 여부는 네트워크 정책에 따라 달라집니다.')
 d.rect(80,230,1600,90,20,C['light'])
 d.text(112,267,'TLS-only mode starts at stage 02.' if not ko else '「TURN/TLS 443만 사용」을 선택하면 02단계에서 시작합니다.',24,C['green'],700)
 d.text(112,300,'Without configured TURN credentials, automatic mode skips stage 02.' if not ko else 'TURN 키가 등록되어 있지 않으면 자동 모드는 02단계를 건너뜁니다.',19,C['muted'])
 xs=[80,650,1220];ww=460
 for x in xs:d.rect(x,370,ww,255,24,C['white'],C['border'])
 d.badge(112,397,'01');d.text(112,485,'Auto · WebRTC' if not ko else '자동 · WebRTC',29,weight=700)
 d.lines(112,532,['ICE gathers direct candidates','and configured TURN routes.','ICE selects a working pair.'] if not ko else ['직접 연결 후보와 등록된 TURN','경로를 함께 수집합니다.','ICE가 동작하는 후보 쌍을 선택합니다.'],21,34,C['muted'])
 d.badge(682,397,'02');d.text(682,485,'TURN/TLS 443 only',27,weight=700)
 d.lines(682,532,['One relay-only retry after failure.','Requires configured TURN keys.','No repeated retry loop.'] if not ko else ['실패하면 중계 전용으로 한 번 재시도.','TURN 키 등록이 필요합니다.','같은 경로를 반복 재시도하지 않습니다.'],21,34,C['muted'])
 d.badge(1252,397,'03',C['pale'],C['amber']);d.text(1252,485,'Connection unavailable' if not ko else '연결 실패 안내',27,weight=700)
 d.lines(1252,532,['Neither WebRTC route connected.','The session ends with an error.','Check the network before retrying.'] if not ko else ['두 WebRTC 경로 모두 연결되지 않으면','오류를 안내하고 세션을 종료합니다.','네트워크를 확인한 뒤 다시 접속하세요.'],21,34,C['muted'])
 d.path('M 540 495 H 650',width=3);d.text(595,465,'Failed' if not ko else '실패',18,C['muted'],anchor='middle')
 d.path('M 1110 495 H 1220',width=3);d.text(1165,465,'Failed' if not ko else '실패',18,C['muted'],anchor='middle')
 for x in xs[:2]:d.path(f'M {x+230} 625 V 704',C['green'],3)
 for x in xs:d.rect(x,720,ww,180,24,C['light'] if x!=1220 else C['pale'])
 d.text(112,766,'Connected by WebRTC' if not ko else 'WebRTC로 연결',25,C['green'],700)
 d.lines(112,813,['Direct or TURN-relayed','Video + control data channel'] if not ko else ['직접 연결 또는 TURN 중계 연결','영상 + 제어 데이터 채널'],21,37,C['muted'])
 d.text(682,766,'Connected via TURN/TLS' if not ko else 'TURN/TLS로 연결',24,C['green'],700)
 d.lines(682,813,['Browser-to-TURN uses TLS 443','The Mac must still be reachable.'] if not ko else ['브라우저 → TURN 구간은 TLS 443','Mac 측 연결 경로도 필요합니다.'],21,37,C['muted'])
 d.text(1252,766,'Review network settings' if not ko else '네트워크 설정 확인',25,C['amber'],700)
 d.lines(1252,813,['Check TURN credentials and rules.','Try another permitted network.'] if not ko else ['TURN 키와 방화벽 정책을 확인하세요.','허용된 다른 네트워크를 사용해 보세요.'],21,37,C['muted'])
 d.rect(80,940,1600,148,24,C['pale'])
 d.text(112,986,'TURN/TLS 443 depends on network policy.' if not ko else 'TURN/TLS 443 연결도 네트워크 정책의 영향을 받습니다.',25,C['amber'],700)
 d.lines(112,1029,['A proxy, firewall or managed browser may still block TURN. This setting does not bypass network policy.','A faster connection is possible only when a compatible route is available.'] if not ko else ['프록시·방화벽·관리형 브라우저는 TURN을 차단할 수 있습니다. 이 설정이 네트워크 정책을 우회하지는 않습니다.','호환되는 연결 경로가 있을 때 빠른 전송이 가능합니다.'],21,34,C['muted'])
 d.footer(2);d.save('connection-paths-'+lang)

def setup_flow(lang):
 ko=lang=='ko'
 d=SVG(1300,lang,'MacLink setup flow' if not ko else 'MacLink 초기 설정 흐름','Four-step setup with Mac registration, one-time permissions, permanent link creation and remote browser access.')
 d.header('GETTING STARTED' if not ko else '시작하기','Set up once. Reconnect with your link.' if not ko else '처음에 설정하고, 이후에는 링크로 다시 접속하세요.','The Mac runs a native Connector; the remote user only needs a supported browser.' if not ko else 'Mac은 Connector를 실행하고, 원격 사용자는 지원되는 브라우저에서 접속합니다.')
 cards=[(80,250,1),(940,250,2),(940,630,3),(80,630,4)]
 for x,y,n in cards:
  d.rect(x,y,740,280,26,C['white'],C['border']);d.badge(x+32,y+28,f'0{n}')
 d.laptop_icon(710,282);d.laptop_icon(1570,282);d.cloud_icon(1570,662);d.browser_icon(710,662)
 d.text(112,378,'Register your Mac' if not ko else 'Mac을 등록합니다',32,weight=700)
 d.lines(112,427,['Sign in with Google at www.maclink.cloud.','Add your Mac; download the DMG and device key.','Keep the device key on your own Mac.'] if not ko else ['www.maclink.cloud에서 Google로 로그인합니다.','Mac 등록 후 DMG와 기기 연결 키를 내려받습니다.','기기 연결 키는 자신의 Mac에 보관합니다.'],22,38,C['muted'])
 d.text(972,378,'Install and connect' if not ko else '앱을 설치하고 연결합니다',32,weight=700)
 d.lines(972,427,['Install the DMG app in Applications and launch it.','Import the device key in Settings.','Allow Screen Recording and Device control.'] if not ko else ['DMG의 앱을 응용 프로그램에 설치·실행합니다.','설정에서 기기 연결 키를 가져옵니다.','화면 기록 · 기기 제어 권한을 허용합니다.'],22,38,C['muted'])
 d.text(972,758,'Create a permanent link' if not ko else '상시 접속 링크를 만듭니다',32,weight=700)
 d.lines(972,807,['Confirm your Mac shows Online.','Create a view-only or control access link.','Share only with people you authorize.'] if not ko else ['Mac 상태가 온라인인지 확인합니다.','보기 전용 또는 제어 권한의 링크를 만듭니다.','접속을 허용할 사람에게만 전달합니다.'],23,38,C['muted'])
 d.text(112,758,'Connect in the browser' if not ko else '브라우저로 원격 접속합니다',32,weight=700)
 d.lines(112,807,['Open the link in a compatible browser.','Enter the host\'s Google sign-in email.','Choose a connection mode and quality.'] if not ko else ['원격 기기의 브라우저에서 링크를 엽니다.','호스트의 Google 로그인 이메일을 입력합니다.','연결 방식과 화면 화질을 선택합니다.'],23,38,C['muted'])
 d.path('M 820 390 H 940',C['green'],4)
 d.path('M 1310 530 V 630',C['green'],4)
 d.path('M 940 770 H 820',C['green'],4)
 d.rect(80,960,1600,185,24,C['light'])
 d.text(112,1008,'Future access needs no repeated approval on the Mac.' if not ko else '이후에는 Mac에서 매번 승인하지 않아도 링크로 접속할 수 있습니다.',27,C['green'],700)
 d.lines(112,1051,['Keep the Mac awake, logged in, online and running the Connector with permissions enabled.','Optional: enable Start MacLink at login in Settings.','The owner can revoke access links or stop remote access at any time.'] if not ko else ['Mac이 깨어 있고 로그인·인터넷 연결 상태이며, 권한이 허용된 Connector가 실행 중이어야 합니다.','설정에서 로그인 시 MacLink 실행을 선택할 수 있습니다.','소유자는 접속 링크를 폐기하거나 원격 접속을 중지할 수 있습니다.'],22,34,C['muted'])
 d.footer(3);d.save('setup-flow-'+lang)

for lang in ['en','ko']:
 architecture(lang);connection_paths(lang);setup_flow(lang)
