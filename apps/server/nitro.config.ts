import { defineNitroConfig } from "nitropack";

const webDistribution = new URL("../web/dist", import.meta.url).pathname;

export default defineNitroConfig({
  preset: "node-server",
  srcDir: "server",
  compatibilityDate: "2026-08-01",
  imports: false,
  errorHandler: "~/error",
  runtimeConfig: {
    metaclanker: {
      dataDirectory: process.env["METACLANKER_DATA_DIR"] ?? ".data",
    },
  },
  experimental: {
    websocket: true,
  },
  publicAssets: [
    {
      baseURL: "/assets",
      dir: `${webDistribution}/assets`,
      maxAge: 60 * 60 * 24 * 365,
    },
  ],
  serverAssets: [{ baseName: "shell", dir: webDistribution, pattern: "index.html" }],
  routeRules: {
    "/api/**": { headers: { "cache-control": "no-store" } },
    "/**": {
      headers: {
        "content-security-policy":
          "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'",
      },
    },
  },
});
