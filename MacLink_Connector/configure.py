import subprocess
from pathlib import Path
from app_runtime import CONFIG_PATH, MAX_CONFIG_BYTES, read_json, save_imported_config, validate_config
path=CONFIG_PATH
if path.exists():
 print('Using the existing device key. To register again, delete the following file and rerun setup:\n'+str(path))
else:
 print('Select the maclink-config.json file downloaded from the website.')
 selected=subprocess.run(['/usr/bin/osascript','-e','POSIX path of (choose file with prompt "Select the MacLink device key file (maclink-config.json)")'],capture_output=True,text=True,check=True).stdout.strip()
 conf=validate_config(read_json(Path(selected), MAX_CONFIG_BYTES))
 print('Website: '+conf['site'])
 if input('Is this the device key for your MacBook on the website above? [y/N] ').strip().lower()!='y':raise SystemExit('Setup canceled.')
 print('Sign in to the Google account that registered this Mac and connect from My Devices.')
 save_imported_config(conf,path)
 print('Configuration saved. Autostart is enabled by Enable-Always-On.command, or by running Enable-Autostart.command separately.')
