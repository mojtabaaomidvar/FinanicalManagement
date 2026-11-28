import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compareReleaseVersions, projectReleaseHistory, requireReleaseEntry, validateReleaseHistory, type ReleaseHistory } from "./release-history";

const source = JSON.parse(readFileSync(new URL("../../../release-history.json", import.meta.url), "utf8"));
const history = () => structuredClone(source) as ReleaseHistory;

describe("release history", () => {
  it("validates the reconstructed local history and orders versions numerically", () => {
    const data = validateReleaseHistory(history());
    const projected = projectReleaseHistory(data, "pwa", "0.11.0");
    expect(projected.slice(0, 3).map(item => item.version)).toEqual(["0.11.0", "0.10.0", "0.9.0"]);
    expect(compareReleaseVersions("0.12.0", "0.9.0")).toBeGreaterThan(0);
  });
  it("removes future releases and technical data before the PWA build", () => {
    const data = history();
    data.releases[0].technical_notes.push({ id: "internal-sentinel", text: "TECHNICAL_SENTINEL" });
    const projected = projectReleaseHistory(data, "pwa", "0.12.0");
    expect(projected.every(item => item.component === "pwa" && !("technical_notes" in item))).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("TECHNICAL_SENTINEL");
    expect(projectReleaseHistory(data, "pwa", "0.11.0").some(item => item.version === "0.12.0")).toBe(false);
    expect(JSON.stringify(projectReleaseHistory(data, "management", "0.3.0"))).toContain("TECHNICAL_SENTINEL");
    expect(data.releases[0].technical_notes).toHaveLength(2);
  });
  it("limits application history to the installed major while management retains all majors and components", () => {
    const data = history();
    const template = data.releases.find(item => item.component === "pwa")!;
    for (const version of ["1.0.0", "1.2.2", "1.2.10", "1.3.0", "2.0.0"]) {
      data.releases.push({ ...structuredClone(template), id: `pwa-${version}`, version });
    }
    validateReleaseHistory(data);
    const original = structuredClone(data);
    const application = projectReleaseHistory(data, "pwa", "1.2.10");
    expect(application.map(item => item.version)).toEqual(["1.2.10", "1.2.2", "1.0.0"]);
    expect(application.every(item => item.component === "pwa" && !("technical_notes" in item))).toBe(true);
    expect(projectReleaseHistory(data, "pwa", "0.15.1").every(item => item.version.startsWith("0."))).toBe(true);
    const management = projectReleaseHistory(data, "management", "0.4.1");
    expect(management).toHaveLength(data.releases.length);
    for (const version of ["0.15.1", "1.0.0", "1.2.10", "2.0.0"]) {
      expect(management.some(item => item.component === "pwa" && item.version === version)).toBe(true);
    }
    expect(management.some(item => item.component === "api")).toBe(true);
    expect(management.some(item => item.component === "management")).toBe(true);
    expect(data).toEqual(original);
  });
  it.each([
    (data: ReleaseHistory) => data.releases.push(data.releases[0]),
    (data: ReleaseHistory) => { data.releases[0].version = "0.12.0-dev"; },
    (data: ReleaseHistory) => { data.releases[0].released_on = "2026-02-30"; },
    (data: ReleaseHistory) => { data.releases[0].technical_notes.push(data.releases[0].technical_notes[0]); },
    (data: ReleaseHistory) => { Object.assign(data.releases[0], { private_config: "forbidden" }); },
    (data: ReleaseHistory) => { data.releases[0].user_notes = null; },
  ])("rejects malformed or ambiguous release records", change => {
    const data = history(); change(data);
    expect(() => validateReleaseHistory(data)).toThrow();
  });
  it("preserves English and empty text without changing release metadata", () => {
    const data = history();
    data.releases[0].user_notes!.summary = "";
    data.releases[0].user_notes!.improvements[0].text = "English";
    expect(validateReleaseHistory(data).releases[0].notes_status).toBe("complete");
  });
  it("blocks official builds whose component/version is absent or partial", () => {
    const data = history();
    expect(() => requireReleaseEntry(data, "pwa", "0.11.0")).not.toThrow();
    expect(() => requireReleaseEntry(data, "pwa", "99.0.0")).toThrow();
    expect(() => requireReleaseEntry(data, "pwa", "0.4.0")).toThrow();
    expect(() => requireReleaseEntry(data, "management", "0.12.0")).toThrow();
  });
});
