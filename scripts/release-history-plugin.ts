import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { noteCopyId, projectReleaseHistory, requireReleaseEntry, summaryCopyId, validateReleaseHistory } from "../src/domain/release-history/release-history";
import { scanReleaseHistory } from "./copy-workbench/release-history.mjs";

/** Generate only the selected audience's data; the source JSON is never a public asset. */
export const releaseHistoryPlugin = (target: "pwa" | "management", version: string): Plugin => {
  const publicId = "virtual:release-history", resolvedId = "\0" + publicId;
  let root = "", preview = false;
  return {
    name: "local-release-history",
    configResolved(config) { root = config.root; preview = config.mode === "copy-workbench"; },
    resolveId(id) { if (id === publicId) return resolvedId; },
    async load(id) {
      if (id !== resolvedId) return;
      const path = resolve(root, "release-history.json");
      this.addWatchFile(path);
      const source = await readFile(path, "utf8");
      const history = validateReleaseHistory(JSON.parse(source));
      requireReleaseEntry(history, target, version);
      const releases = projectReleaseHistory(history, target, version);
      const permitted = new Set(releases.flatMap(item => [summaryCopyId(item.id),
        ...Object.values(item.user_notes ?? {}).flatMap(notes => Array.isArray(notes) ? notes.map(note => noteCopyId(item.id, note.id)) : []),
        ...(target === "management" ? (item.technical_notes ?? []).map(note => noteCopyId(item.id, note.id)) : [])]));
      const sources = preview ? Object.fromEntries(scanReleaseHistory(source).entries
        .filter(entry => permitted.has(entry.annotationId))
        .map(entry => [entry.annotationId, { id: entry.annotationId, file: "release-history.json", line: entry.line, text: entry.text, context: entry.context }])) : {};
      return `export default ${JSON.stringify({ releases, sources }).replaceAll("<", "\\u003c")};`;
    },
  };
};
