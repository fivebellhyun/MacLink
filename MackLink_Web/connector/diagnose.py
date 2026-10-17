"""Read-only connector diagnostics. Never prints device tokens or invitation secrets."""
import argparse
import importlib
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from app_runtime import VERSION
ROOT = Path.home() / 'Library/Application Support/MacLink'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def safe(value):
    return re.sub(r'(?i)[a-f0-9]{64}', '[device key hidden]', str(value))[:400]

def recent_messages():
    try:
        with (ROOT/'connector.log').open('rb') as log:
            log.seek(0,2)
            log.seek(max(0,log.tell()-16384))
            lines = log.read().decode(errors='replace').splitlines()[-20:]
        print('Recent connector messages (also useful when the connector is online):')
        for line in lines:
            print(safe(line))
    except OSError:
        print('No autostart log was found. If the connector was started manually, check its Terminal window.')

def server_check(config, timeout=6):
    site = str(config.get('site', '')).rstrip('/')
    u = urlparse(site)
    if u.scheme != 'https' or not u.netloc or u.path or u.query or u.fragment or u.username:
        raise ValueError('Check the HTTPS website address in the configuration file.')
    if not re.fullmatch(r'[a-f0-9]{24}', str(config.get('device', ''))) or not re.fullmatch(r'[a-f0-9]{64}', str(config.get('token', ''))):
        raise ValueError('The device key in the configuration file is invalid.')
    import certifi
    request = urllib.request.Request(site+'/api/agent/'+config['device']+'/check', headers={'Authorization': 'Bearer '+config['token'], 'Accept': 'application/json', 'Accept-Language': 'en'})
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
    with opener.open(request, timeout=timeout) as response:
        if response.headers.get_content_type() != 'application/json':
            raise ValueError('The website returned a sign-in or HTML page instead of an API response. Check the website address.')
        return json.loads(response.read(16000))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wait', type=int, default=0)
    args = parser.parse_args()
    print('MacLink '+VERSION+' connection diagnostics - device keys are never displayed.', flush=True)
    if sys.platform != 'darwin':
        print('Run these diagnostics in Terminal on the MacBook where MacLink is installed.')
        return 1
    print('Python:', sys.version.split()[0], '/ executable:', sys.executable)
    try:
        config = json.loads((ROOT/'config.json').read_text())
    except (OSError, ValueError):
        print('Configuration is missing or invalid. Run Enable-Always-On.command first and select the device key file.')
        return 1
    print('Website:', urlparse(str(config.get('site', ''))).hostname)
    modules = {}
    for name in ('Quartz', 'ApplicationServices', 'aiohttp', 'certifi', 'mss', 'PIL', 'aiortc'):
        try:
            modules[name] = importlib.import_module(name)
        except Exception as exc:
            print('Required module failed:', name, type(exc).__name__, safe(exc))
    if len(modules) != 7:
        print('Run Enable-Always-On.command from the latest download again to install the required libraries.')
        return 1
    try:
        print('Permissions for this Terminal - screen:', bool(modules['Quartz'].CGPreflightScreenCaptureAccess()), '/ input:', bool(modules['ApplicationServices'].AXIsProcessTrusted()))
        print('The server status below shows the actual permissions reported by the autostart connector.')
    except Exception as exc:
        print('Permission API check failed:', type(exc).__name__, safe(exc))
        return 1
    deadline = time.monotonic()+max(0, min(args.wait, 20))
    data = None
    while True:
        try:
            data = server_check(config)
        except urllib.error.HTTPError as exc:
            if exc.code in (401,403):
                print('Server authentication was rejected. Check the device key and website access settings.')
                break
            if 300 <= exc.code < 400:
                print('The server requested a redirect. Check the configured website address and public access settings.')
                break
            print('Server response error: HTTP', exc.code)
        except Exception as exc:
            print('Server connection failed:', type(exc).__name__, safe(exc))
        if data and data.get('online') and data.get('info', {}).get('version') == VERSION:
            info = data.get('info', {})
            print('Server authentication succeeded - connector '+VERSION+' online')
            print('Autostart permissions - screen:', bool(info.get('screen')), '/ input:', bool(info.get('accessibility')))
            recent_messages()
            return 0
        if time.monotonic() >= deadline:
            break
        time.sleep(1)
    if data:
        print('Server authentication succeeded / connector:', 'online' if data.get('online') else 'offline', '/ reported version:', data.get('info', {}).get('version', 'none'))
    job = subprocess.run(['launchctl','print','gui/'+str(os.getuid())+'/com.maclink.connector'],capture_output=True,text=True)
    if job.returncode:
        print('Autostart service is not registered or running. Run Enable-Always-On.command.')
    else:
        for line in job.stdout.splitlines():
            if re.match(r'\s*(state|pid|last exit code) =', line):
                print('Autostart service:', line.strip())
    recent_messages()
    print('Share these diagnostic results to help identify the remaining issue. Do not share config.json.')
    return 1

if __name__ == '__main__':
    raise SystemExit(main())
