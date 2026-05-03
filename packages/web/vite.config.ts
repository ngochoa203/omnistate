import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const port = process.env.VITE_PORT ? Number.parseInt(process.env.VITE_PORT, 10) : 5173;
const host = process.env.VITE_HOST || undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port,
    host,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:19801",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:19800",
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
  },
});
