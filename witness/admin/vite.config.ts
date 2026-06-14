import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  base: "/admin/",
  build: {
    outDir: "../public/admin",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/admin/auth": "http://localhost:3000",
      "/admin/api": "http://localhost:3000",
    },
  },
});
