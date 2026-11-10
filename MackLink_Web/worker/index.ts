import handler from "vinext/server/fetch-handler";
import { withSecurityHeaders } from "../lib/security-headers";

// Cloudflare Workers entry. vinext serves pages and route handlers; bindings
// such as DB and ASSETS come from wrangler.jsonc through `cloudflare:workers`.
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
