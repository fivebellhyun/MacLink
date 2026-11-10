// Bindings and variables configured in wrangler.jsonc, secrets and .dev.vars.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ASSETS?: Fetcher;
    AUTH_BASE_URL?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    TURN_CONFIG_KEY?: string;
  }
}
