import { defineNitroConfig } from "nitropack";

const webDistribution = new URL("../web/dist", import.meta.url).pathname;

export default defineNitroConfig({
  preset: "node-server",
  srcDir: "server",
  compatibilityDate: "2026-08-01",
  experimental: {
    websocket: true,
  },
  publicAssets: [
    {
      dir: webDistribution,
      maxAge: 60 * 60 * 24 * 365,
    },
  ],
  routeRules: {
    "/api/**": { cors: false },
    "/**": {
      headers: {
        "content-security-policy":
          "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'",
      },
    },
  },
});
