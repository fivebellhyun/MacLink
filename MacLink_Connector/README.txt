MacLink Connector 1.3.2 - macOS menu bar app

Install MacLink.app once on the host Mac. Authorized remote users then view or
control the Mac in a browser through the website's permanent access link.
The app bundles Python and its dependencies; users do not install Python, extract
a source ZIP, or leave Terminal open.

Installation

1. Requires macOS 13 or later and an internet connection. The host must be awake
   and logged in. Deploy the MacLink website/API before registering a device.
2. Register the Mac under My Devices on your own website. Download the device key
   maclink-config.json. Keep it private and never commit it to Git.
3. Download the matching DMG from:
   https://github.com/fivebellhyun/MacLink/releases
   Apple silicon: MacLink-Connector-arm64.dmg
   Intel:         MacLink-Connector-x86_64.dmg
   Release files are available only after a maintainer publishes a release.
4. Open the DMG, drag MacLink into Applications, and launch MacLink.
   The ML icon appears in the macOS menu bar.
5. Choose Import connection key..., select maclink-config.json, and confirm the
   website and device. Importing replaces any existing local key and ends the
   current connection. The connector starts after import; use Start connector
   if it is stopped.
6. Use Screen Recording settings... and Accessibility settings... in the menu.
   In System Settings > Privacy & Security, allow MacLink to record the screen
   and control keyboard/mouse input. Permission labels vary by macOS version.
   Choose Restart connector after changing permissions.
7. Check the menu status and the website's Online, Screen allowed, and Input
   allowed indicators. Create a Permanent Access Link for view-only or control
   access. Creating that link is advance authorization for later connections.
8. Enable Start at login if desired. This starts the app after macOS login; it
   does not unlock FileVault or run before login.

Click the menu bar icon to open the native dashboard. Home shows connection,
session and permission status; Settings contains connector and startup controls.
The Accessibility status is labelled "기기 제어" in the app. Right-click the
menu bar icon for the quick menu.

The Support tab offers "껌 던져주기", "따뜻한 커피 한 잔 후원하기" and
"밥 후원하기". Payments are not enabled: each button displays an information
dialog only and does not open a payment page or collect payment information.

Signing and notarization depend on the maintainer's Apple credentials and release
configuration; do not assume a build is signed or notarized. If macOS blocks an
unsigned build, verify its source and origin before allowing it in Privacy &
Security settings.

Menu and troubleshooting

- Start connector / Stop connector / Restart connector manage the local worker.
- Status shows server connection, current session, and macOS permissions.
- Open MacLink website opens the website configured in the imported key.
- Open log opens the local connector log. Do not share your config.json or key.
- Start at login enables or disables automatic launch after login.
- Quit MacLink stops the worker and removes the menu bar icon.

Installing the app or granting permissions alone does not prove it is online.
Check the actual menu/website status. If offline, check the imported key, website,
network, and recent log. For browser problems, use Settings > Connection
Diagnostics. Reports omit addresses, credentials, desktop content, and input.

If upgrading from the old Python/Terminal installation, stop its Terminal process
and run Disable-Autostart.command from that source folder before using the app.
The old background service and menu bar app should not run simultaneously.

Update and removal

- Quit MacLink, replace the installed app with the newer DMG version, then reopen
  it. The device configuration remains in:
  ~/Library/Application Support/MacLink/config.json
- To remove the app, disable Start at login, quit, and delete MacLink.app from
  /Applications or ~/Applications. Delete the Application Support/MacLink folder
  only if you also want to remove the stored key and local data.
- Removing a device on the website invalidates its key. Register again, download
  a new key, and use Import connection key... to replace it.
- Stop connector pauses this Mac's remote access. Revoke access on the website
  to invalidate existing permanent links and sessions.

Availability and access

Leave the lid open and connect power. While running, the connector prevents
normal idle sleep; it cannot override lid closure or manually requested sleep.
Access is unavailable while the Mac is asleep, logged out, or at the pre-login
FileVault unlock screen. Access to a locked Mac is not guaranteed.

Permanent access links have no expiration or use limit until revoked. Disconnect
ends the current session; it does not revoke a reusable link. Optional one-time
invitations expire after one hour and normally prompt for approval on the Mac.
The remote device needs only a compatible WebRTC browser, not this app.

Display and transport

One primary display and one remote user at a time are supported. Quality targets:
Fast:   up to 1600 px / 15 fps, target 2 Mbps / cap 4 Mbps
Medium: up to 1600 px / 24 fps, target 4 Mbps / cap 8 Mbps (default)
Sharp:  up to 2560 px / 30 fps, target 8 Mbps / cap 16 Mbps
Ultra:  up to 2560 px / 60 fps, target 16 Mbps / cap 40 Mbps
The source aspect ratio is preserved without upscaling. Actual rates depend on
Mac performance, negotiated codec, congestion control and network conditions.

WebRTC video and input are encrypted. A configured TURN service can relay the
browser's WebRTC traffic. The connector itself uses STUN. If direct and TURN
paths fail, the connection ends with a network error. Screen images and input
are never uploaded to the website for forwarding. HTTPS protects website,
login, device authorization and WebRTC signaling requests.
Website: https://www.maclink.cloud

After temporary network loss, the browser attempts recovery. Authorization
checks pause new frames/input after seventeen seconds without fresh confirmation and
can retain the existing WebRTC transport for up to thirty seconds. Revocation,
a different session/generation, or lost macOS permissions ends the old transport.

Audio streaming, dedicated file transfer, multi-monitor switching, Wake-on-LAN,
and pre-login/FileVault control are not implemented. Remote input has no dedicated
shell execution API. The connector initiates outbound connections and opens no
inbound HTTP listening port. Protect access links like passwords.

Developer source alternative

From the repository root on macOS, with Python 3.11-3.14:
  bash scripts/build-macos-app.sh
  bash scripts/build-macos-app.sh --install
The second command also copies the app into ~/Applications/MacLink.app; launch it
yourself to configure it. It does not launch the app or enable login startup.
Builds require network access for dependencies and produce dist/MacLink.app plus
an architecture-specific DMG. A local build does not publish a GitHub release.
Legacy .command source launchers remain available and require external Python.
