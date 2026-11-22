// Package the same preset data with the independently deployable FastAPI backend.
import { readFile, writeFile, mkdir } from "node:fs/promises";
const source = new URL("../src/domain/inventory/inventory.catalog.json", import.meta.url);
const destination = new URL("../backend/app/data/inventory.catalog.json", import.meta.url);
const contents = await readFile(source, "utf8");
JSON.parse(contents);
await mkdir(new URL("../backend/app/data/", import.meta.url), { recursive: true });
await writeFile(destination, contents, "utf8");
console.log("Packaged inventory catalog synchronized.");
