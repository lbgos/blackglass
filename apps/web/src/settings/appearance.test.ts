// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_DENSITY,
  DEFAULT_GLASS_OPACITY,
  applyDensity,
  applyGlassOpacity,
  clampGlassOpacity,
  glassSliderProgress,
  installAppearanceSync,
  parseDensity,
  parseGlassOpacity,
  parseReducedMotion,
  readGlassOpacity,
} from "./appearance.js";

describe("parseGlassOpacity bounds 5..40", () => {
  it("accepts min, max, and default within 5..40", () => {
    expect(parseGlassOpacity("5")).toBe(5);
    expect(parseGlassOpacity("26")).toBe(26);
    expect(parseGlassOpacity("40")).toBe(40);
  });

  it("rejects outside 5..40 strictly", () => {
    expect(parseGlassOpacity("4")).toBeNull();
    expect(parseGlassOpacity("0")).toBeNull();
    expect(parseGlassOpacity("-1")).toBeNull();
    expect(parseGlassOpacity("41")).toBeNull();
    expect(parseGlassOpacity("55")).toBeNull();
    expect(parseGlassOpacity("100")).toBeNull();
  });

  it("rejects non-integers, empty, and malformed", () => {
    expect(parseGlassOpacity("")).toBeNull();
    expect(parseGlassOpacity("  ")).toBeNull();
    expect(parseGlassOpacity("26.5")).toBeNull();
    expect(parseGlassOpacity("oops")).toBeNull();
    expect(parseGlassOpacity(null)).toBeNull();
    expect(parseGlassOpacity(undefined)).toBeNull();
    expect(parseGlassOpacity(26 as unknown as string)).toBeNull();
  });

  it("clamps UI values to 5..40", () => {
    expect(clampGlassOpacity(0)).toBe(5);
    expect(clampGlassOpacity(4)).toBe(5);
    expect(clampGlassOpacity(5)).toBe(5);
    expect(clampGlassOpacity(26)).toBe(26);
    expect(clampGlassOpacity(40)).toBe(40);
    expect(clampGlassOpacity(41)).toBe(40);
    expect(clampGlassOpacity(100)).toBe(40);
  });

  it("maps glass progress 5..40 to 0..100", () => {
    expect(glassSliderProgress(5)).toBeCloseTo(0);
    expect(glassSliderProgress(26)).toBeCloseTo(60);
    expect(glassSliderProgress(40)).toBeCloseTo(100);
    expect(glassSliderProgress(0)).toBeCloseTo(0);
    expect(glassSliderProgress(100)).toBeCloseTo(100);
  });

  it("falls back to default for out-of-range persisted values", () => {
    const storage = {
      getItem: (key: string) => (key === "blackglass.glassOpacity" ? "4" : null),
      setItem: () => {},
    };
    expect(readGlassOpacity(storage as any)).toBe(DEFAULT_GLASS_OPACITY);
    const storage2 = {
      getItem: (key: string) => (key === "blackglass.glassOpacity" ? "41" : null),
      setItem: () => {},
    };
    expect(readGlassOpacity(storage2 as any)).toBe(DEFAULT_GLASS_OPACITY);
    const storage3 = {
      getItem: (key: string) => (key === "blackglass.glassOpacity" ? "100" : null),
      setItem: () => {},
    };
    expect(readGlassOpacity(storage3 as any)).toBe(DEFAULT_GLASS_OPACITY);
  });

  it("parses density strictly", () => {
    expect(parseDensity("compact")).toBe("compact");
    expect(parseDensity("regular")).toBe("regular");
    expect(parseDensity("huge")).toBeNull();
    expect(parseDensity("")).toBeNull();
  });

  it("parses reducedMotion strictly", () => {
    expect(parseReducedMotion("true")).toBe(true);
    expect(parseReducedMotion("false")).toBe(false);
    expect(parseReducedMotion("maybe")).toBeNull();
  });
});

function readStylesCss(): string {
  const candidates = [
    path.join(process.cwd(), "apps/web/src/styles.css"),
    path.join(process.cwd(), "src/styles.css"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {}
  }
  throw new Error("styles.css not found");
}

describe("density CSS contract", () => {
  it("consumes --density-row-min via explicit .settings-row and differentiates regular", () => {
    const css = readStylesCss();
    expect(css).toContain("--density-row-min");
    expect(css).toContain(".settings-row");
    expect(css).toContain("var(--density-row-min)");
    expect(css).toContain('[data-density="regular"] .settings-row');
    expect(css).toContain("padding-block: 18px");
    expect(css).toContain("padding-block: 14px");
    expect(css).toContain("max(44px");
    const compactMatch = css.match(/:root\[data-density="compact"\]\s*\{\s*--density-row-min:\s*(\d+)px/);
    const regularMatch = css.match(/:root\[data-density="regular"\]\s*\{\s*--density-row-min:\s*(\d+)px/);
    expect(compactMatch).toBeTruthy();
    expect(regularMatch).toBeTruthy();
    const compactVal = Number(compactMatch![1]);
    const regularVal = Number(regularMatch![1]);
    expect(compactVal).toBeGreaterThanOrEqual(44);
    expect(regularVal).toBeGreaterThan(compactVal);
  });

  it("applies density to root and settings rows retain 44px floor", () => {
    const root = document.documentElement as unknown as Parameters<typeof applyDensity>[0];
    applyDensity(root, "compact");
    expect(document.documentElement.dataset.density).toBe("compact");
    applyDensity(root, "regular");
    expect(document.documentElement.dataset.density).toBe("regular");
    const row = document.createElement("div");
    row.className = "settings-row";
    document.body.appendChild(row);
    expect(row.classList.contains("settings-row")).toBe(true);
    const css = readStylesCss();
    expect(css).toMatch(/\.settings-row\s*\{[^}]*var\(--density-row-min\)/);
    row.remove();
    applyDensity(root, DEFAULT_DENSITY);
  });

  it("does not globally shrink controls: only .settings-row uses the token", () => {
    const css = readStylesCss();
    const matches = [...css.matchAll(/var\(--density-row-min\)/g)];
    expect(matches.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/\*\s*\{[^}]*--density-row-min/);
    expect(css).not.toMatch(/button\s*\{[^}]*--density-row-min/);
  });
});

describe("installAppearanceSync runtime", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.glassOpacity = "";
    document.documentElement.dataset.density = "";
    document.documentElement.dataset.reducedMotion = "";
    document.documentElement.dataset.theme = "dark";
    document.documentElement.className = "";
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.glassOpacity = "";
    document.documentElement.dataset.density = "";
    document.documentElement.dataset.reducedMotion = "";
    vi.restoreAllMocks();
  });

  it("updates root on cross-tab storage events without Settings mounted", () => {
    window.localStorage.setItem("blackglass.glassOpacity", "26");
    window.localStorage.setItem("blackglass.density", "compact");
    document.documentElement.dataset.glassOpacity = "26";
    document.documentElement.dataset.density = "compact";
    const cleanup = installAppearanceSync(window);
    // Simulate cross-tab change to valid values
    window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "30" }));
    expect(document.documentElement.dataset.glassOpacity).toBe("30");
    window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.density", newValue: "regular" }));
    expect(document.documentElement.dataset.density).toBe("regular");
    window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.reducedMotion", newValue: "true" }));
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    // Invalid glass value must be ignored
    window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "4" }));
    expect(document.documentElement.dataset.glassOpacity).toBe("30");
    window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "41" }));
    expect(document.documentElement.dataset.glassOpacity).toBe("30");
    cleanup();
    window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "32" }));
    expect(document.documentElement.dataset.glassOpacity).toBe("30");
  });

  it("updates glass when theme changes on /plugins via MutationObserver", async () => {
    window.localStorage.setItem("blackglass.glassOpacity", "26");
    document.documentElement.dataset.theme = "dark";
    applyGlassOpacity(document.documentElement as any, 26);
    const darkGlass = getComputedStyle(document.documentElement).getPropertyValue("--glass") || (document.documentElement.style.getPropertyValue("--glass"));
    const cleanup = installAppearanceSync(window);
    document.documentElement.dataset.theme = "light";
    // MutationObserver is async; wait a tick
    await new Promise((r) => setTimeout(r, 0));
    const lightGlass = document.documentElement.style.getPropertyValue("--glass");
    expect(lightGlass).not.toBe(darkGlass);
    expect(document.documentElement.dataset.glassOpacity).toBe("26");
    cleanup();
  });

  it("is exception-safe and returns cleanup without leaking", () => {
    const originalAdd = window.addEventListener;
    const originalRemove = window.removeEventListener;
    // Simulate blocked storage and style
    const cleanup = installAppearanceSync(window);
    expect(typeof cleanup).toBe("function");
    // Should not throw when storage throws
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    // Should not throw on storage event
    expect(() => window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "30" }))).not.toThrow();
    cleanup();
    // After cleanup, listeners removed; dispatch should not update
    const before = document.documentElement.dataset.glassOpacity;
    window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "32" }));
    expect(document.documentElement.dataset.glassOpacity).toBe(before);
    // Restore
    vi.restoreAllMocks();
    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
  });

  it("handles null key as bulk sync and style unavailability", () => {
    window.localStorage.setItem("blackglass.glassOpacity", "30");
    window.localStorage.setItem("blackglass.density", "regular");
    const cleanup = installAppearanceSync(window);
    // Event with null key should re-apply all
    window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
    expect(document.documentElement.dataset.glassOpacity).toBe("30");
    expect(document.documentElement.dataset.density).toBe("regular");
    cleanup();
  });
});
