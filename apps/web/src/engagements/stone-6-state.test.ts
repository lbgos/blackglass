// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  emptyWorkspaceState,
  loadWorkspaceState,
  parseWorkspaceState,
  saveWorkspaceState,
  workspaceStateKey,
  type WorkspaceStateStore,
} from "./workspace-state.js";
import { focusedStarredView, toggleStarred } from "./star-filter.js";
import { registeredStone6Slots, mountStone6Slot, registerStone6Slot, STONE_6_SLOT_NAMES } from "./extension-slots.js";

function memoryStore(initial: Record<string, string> = {}): WorkspaceStateStore {
  const data = new Map(Object.entries(initial));
  return {
    load: (key) => data.get(key) ?? null,
    save: (key, value) => {
      data.set(key, value);
    },
  };
}

const ENGAGEMENT_ID = "10000000-0000-4000-8000-000000000001";

describe("workspace state reload restores the narrowed view", () => {
  it("round-trips selection, drafts, filters, and starred ids", () => {
    const store = memoryStore();
    saveWorkspaceState(store, ENGAGEMENT_ID, {
      ...emptyWorkspaceState(),
      selectedTarget: "https://target.example/",
      selectedRunId: "run-3",
      inspectorSelection: "artifact:abc",
      launcherInputs: { threads: "40" },
      drafts: { notes: "draft text" },
      filters: { runs: "failed" },
      starredIds: ["target-1"],
      lastWordlistName: "common",
    });
    // Simulate a browser close and return: reload from the same store.
    const restored = loadWorkspaceState(store, ENGAGEMENT_ID);
    expect(restored.selectedTarget).toBe("https://target.example/");
    expect(restored.selectedRunId).toBe("run-3");
    expect(restored.drafts["notes"]).toBe("draft text");
    expect(restored.filters["runs"]).toBe("failed");
    expect(restored.starredIds).toEqual(["target-1"]);
    expect(restored.lastWordlistName).toBe("common");
  });

  it("resets corrupt or version-mismatched payloads instead of crashing", () => {
    expect(parseWorkspaceState("not-json").selectedTarget).toBe(null);
    expect(parseWorkspaceState(JSON.stringify({ version: 999 })).filters).toEqual({});
    expect(parseWorkspaceState(null).starredIds).toEqual([]);
    expect(workspaceStateKey(ENGAGEMENT_ID)).toContain(ENGAGEMENT_ID);
  });
});

describe("starred focus", () => {
  const items = [
    { id: "a", hasActiveJob: false },
    { id: "b", hasActiveJob: true },
    { id: "c", hasActiveJob: false },
  ];

  it("toggles stars without touching other ids", () => {
    expect(toggleStarred([], "a")).toEqual(["a"]);
    expect(toggleStarred(["a"], "a")).toEqual([]);
  });

  it("narrows to starred but never hides active jobs", () => {
    expect(focusedStarredView(items, ["a"], true).map((item) => item.id)).toEqual(["a", "b"]);
    expect(focusedStarredView(items, ["a"], false)).toHaveLength(3);
  });
});

describe("extension slots", () => {
  it("exposes the STONE-2 integration contract and reports absent hosts", () => {
    expect(STONE_6_SLOT_NAMES).toContain("engagement.resume");
    expect(STONE_6_SLOT_NAMES).toContain("engagement.search");
    const host = document.createElement("div");
    expect(mountStone6Slot("engagement.resume", { engagementId: ENGAGEMENT_ID, archived: false }, host)).toBe(false);
    registerStone6Slot("engagement.resume", () => () => {});
    expect(registeredStone6Slots()).toContain("engagement.resume");
    expect(mountStone6Slot("engagement.resume", { engagementId: ENGAGEMENT_ID, archived: false }, host)).toBe(true);
  });
});
