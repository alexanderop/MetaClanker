import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: {
    port: 4318,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
