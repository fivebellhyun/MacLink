import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

// Worker name, bindings (DB, ASSETS) and variables are read from wrangler.jsonc.
// Local development keeps D1 state in .wrangler/ and reads secrets from .dev.vars.
export default defineConfig({
  environments: {
    client: {
      build: { target: ["chrome80", "edge80", "firefox78", "safari14"] },
    },
  },
  // `pnpm dev` and `pnpm preview` share one origin, so a single local
  // AUTH_BASE_URL (http://localhost:5173) in .dev.vars works for both.
  server: { port: 5173 },
  preview: { port: 5173 },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      inspectorPort: false,
    }),
  ],
});
