import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      "/trpc": "http://127.0.0.1:4000",
      "/api": "http://127.0.0.1:4000",
    },
  },
});
