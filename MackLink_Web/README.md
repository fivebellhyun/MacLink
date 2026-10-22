# MacLink website 1.4.1

The Korean/English client for `https://www.maclink.cloud` manages registered devices, Google sign-in and account-owned WebRTC remote sessions. It uses React/Sites/Vinext, Cloudflare Workers and D1.

Screens and remote input travel over direct WebRTC or optional encrypted TURN. The website has no media-upload or input-queue APIs. HTTPS still protects ordinary site, authentication and signaling requests.

See the repository [English README](../README.md), [Korean README](../README.ko.md), [developer notes](docs/DEVELOPER_NOTES.md) and [Google login setup](docs/GOOGLE_LOGIN_SETUP.ko.md).

Use Node.js 22.13+ and pnpm 11.25.0. Supply deployment-specific `.openai/hosting.json`, `DB`, OAuth settings and `TURN_CONFIG_KEY` without committing secrets.

```bash
pnpm install --frozen-lockfile
pnpm dev
node --experimental-strip-types --experimental-sqlite --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm build
```

The canonical Connector lives in `../MacLink_Connector/`. Run `python3 scripts/sync-connector.py` from the repository root after modifying it. Keep prior SQL migrations and add new ones for schema changes.
