# MacLink website 1.4.4

The Korean/English client for `https://www.maclink.cloud` manages registered devices, Google sign-in and account-owned WebRTC remote sessions. It is built with React/Vinext and runs on Cloudflare Workers with a D1 database, deployed with Wrangler to the operator's own Cloudflare account.

Screens and remote input travel over direct WebRTC or optional encrypted TURN. The website has no media-upload or input-queue APIs. HTTPS still protects ordinary site, authentication and signaling requests.

See the repository [English README](../README.md), [Korean README](../README.ko.md), [developer notes](docs/DEVELOPER_NOTES.md), [deployment guide](docs/DEPLOYMENT.ko.md) and [Google login setup](docs/GOOGLE_LOGIN_SETUP.ko.md).

Use Node.js 22.13+ and pnpm 11.25.0. `wrangler.jsonc` defines the Worker, the `DB` (D1) and `ASSETS` bindings and `AUTH_BASE_URL`. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TURN_CONFIG_KEY` with `wrangler secret put` in production and in `.dev.vars` locally; never commit them.

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm db:migrate:remote   # production D1, after setting database_id in wrangler.jsonc
pnpm run deploy          # vite build + wrangler deploy
```

The canonical Connector lives in `../MacLink_Connector/`. Run `python3 scripts/sync-connector.py` from the repository root after modifying it. Keep prior SQL migrations and add new ones for schema changes.
