import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { releaseHistoryPlugin } from "./scripts/release-history-plugin";

const version = JSON.parse(readFileSync(new URL("./management-version.json", import.meta.url), "utf8")).version as string;

// Independent build: no application proxy, production env, fixtures or service worker.
export default defineConfig({
  base: "./",
  plugins: [releaseHistoryPlugin("management", version), react(), {
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
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: ".local-test/management-web",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./management.html", import.meta.url)) },
  },
});
