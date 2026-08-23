import { describe, expect, it } from "vitest";

import { PLUGIN_CATALOG, catalogForTab } from "./catalog.js";

describe("plugin catalog", () => {
  it("keeps every entry gated behind decision gate D5", () => {
    expect(PLUGIN_CATALOG.length).toBeGreaterThan(0);
    for (const entry of PLUGIN_CATALOG) {
      expect(entry.enabled).toBe(false);
      expect(entry.origin).toMatch(/first-party/);
    }
  });

  it("partitions entries between the installed and available tabs", () => {
    const installed = catalogForTab(PLUGIN_CATALOG, "installed");
    const available = catalogForTab(PLUGIN_CATALOG, "available");
    expect(installed.every((entry) => entry.installed)).toBe(true);
    expect(available.every((entry) => !entry.installed)).toBe(true);
    expect([...installed, ...available]).toHaveLength(PLUGIN_CATALOG.length);
  });

  it("declares an external executable for every contract-backed entry", () => {
    for (const entry of PLUGIN_CATALOG) {
      expect(entry.executable).not.toBe("");
      expect(entry.tier).toMatch(/^T[0-3]$/);
    }
  });
});
