"""Explicit user-operated Login LaunchAgent installation/removal."""
import os, plistlib, subprocess, sys
from pathlib import Path
root=Path.home()/'Library/Application Support/MacLink'
plist=Path.home()/'Library/LaunchAgents/com.maclink.connector.plist'
domain='gui/'+str(os.getuid())
if sys.argv[1]=='disable':
 subprocess.run(['launchctl','bootout',domain,str(plist)],check=False)
 plist.unlink(missing_ok=True)
 print('MacLink autostart is disabled. Stop any manually started connector in its Terminal window separately.')
else:
 if not (root/'config.json').exists():raise SystemExit('First, run Start-MacLink.command to configure MacLink and grant macOS permissions.')
 print('MacLink will start automatically after you log in to macOS. Logs are saved in the MacLink folder.')
 print('If a connector is running manually, stop it with Ctrl+C in its Terminal window before continuing.')
 if '--yes' not in sys.argv and input('Enable autostart? [y/N] ').strip().lower()!='y':raise SystemExit('Canceled.')
 plist.parent.mkdir(parents=True,exist_ok=True)
 log=root/'connector.log'
 log.touch(mode=0o600,exist_ok=True)
 payload={'Label':'com.maclink.connector','ProgramArguments':[str(root/'venv/bin/python'),str(root/'maclink.py'),'--config',str(root/'config.json')],'WorkingDirectory':str(root),'RunAtLoad':True,'KeepAlive':{'SuccessfulExit':False},'ThrottleInterval':30,'ProcessType':'Interactive','StandardOutPath':str(log),'StandardErrorPath':str(log)}
 with plist.open('wb') as f:plistlib.dump(payload,f)
 os.chmod(plist,0o600)
 subprocess.run(['launchctl','bootout',domain,str(plist)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True)
 print('Autostart is enabled. macOS may treat the background Python process differently from Terminal. Check the permission status on the website and, if needed, grant permissions to the Python executable as well.')
