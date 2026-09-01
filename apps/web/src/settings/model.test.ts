import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_INDEX,
  SETTINGS_SECTIONS,
  searchSettings,
} from "./model.js";

describe("settings model", () => {
  it("lists the eight reference sections in order", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "general",
      "appearance",
      "engagements",
      "plugins",
      "runner",
      "advisor",
      "evidence",
      "diagnostics",
    ]);
    expect(DEFAULT_SETTINGS_SECTION).toBe("appearance");
  });

  it("indexes at least one entry for every section", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS_INDEX.some((entry) => entry.section === section.id)).toBe(true);
    }
  });

  it("returns no hits for an empty or whitespace query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("matches titles, descriptions, and section names case-insensitively", () => {
    const byTitle = searchSettings("RETENTION");
    expect(byTitle.map((entry) => entry.id)).toContain("retention");

    const byDescription = searchSettings("content-addressed");
    expect(byDescription.map((entry) => entry.id)).toContain("evidence-path");

    const bySection = searchSettings("advisor");
    expect(bySection.every((entry) => entry.section === "advisor")).toBe(true);
    expect(bySection.length).toBeGreaterThan(1);
  });
});
