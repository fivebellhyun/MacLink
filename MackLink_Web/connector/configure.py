import json, os, re, subprocess
from pathlib import Path
from urllib.parse import urlparse
root=Path.home()/'Library/Application Support/MacLink'
path=root/'config.json'
if path.exists():
 print('Using the existing device key. To register again, delete the following file and rerun setup:\n'+str(path))
else:
 print('Select the maclink-config.json file downloaded from the website.')
 selected=subprocess.run(['/usr/bin/osascript','-e','POSIX path of (choose file with prompt "Select the MacLink device key file (maclink-config.json)")'],capture_output=True,text=True,check=True).stdout.strip()
 conf=json.loads(Path(selected).read_text())
 url=urlparse(conf['site'])
 assert url.scheme=='https' and url.netloc and url.path in ('','/') and not url.query and not url.fragment and not url.username, 'An HTTPS website address is required.'
 assert re.fullmatch('[a-f0-9]{24}',conf['device']) and re.fullmatch('[a-f0-9]{64}',conf['token']), 'The device key is invalid.'
 print('Website: '+conf['site'])
 if input('Is this the device key for your MacBook on the website above? [y/N] ').strip().lower()!='y':raise SystemExit('Setup canceled.')
 print('Creating a permanent access link on the website authorizes future connections without repeated approval. Single-use invitations require separate approval.')
 conf['allow_unattended']=False
 with os.fdopen(os.open(path,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600),'w') as f:json.dump(conf,f)
 print('Configuration saved. Autostart is enabled by Enable-Always-On.command, or by running Enable-Autostart.command separately.')
