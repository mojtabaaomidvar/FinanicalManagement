import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync(new URL("./management-version.json", import.meta.url), "utf8")).version as string;

// Independent build: no application proxy, production env, fixtures or service worker.
export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "management-version",
    generateBundle() {
      this.emitFile({
        type: "asset", fileName: "version.json",
        source: JSON.stringify({ name: "khaneyar-management", version, builtAt: new Date().toISOString() }) + "\n",
      });
    },
  }],
  publicDir: false,
  envDir: false,
  build: {
    outDir: ".local-test/management-web",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./management.html", import.meta.url)) },
  },
});
