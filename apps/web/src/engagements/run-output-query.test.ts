import { describe, expect, it, vi, afterEach } from "vitest";

import {
  NoTerminalRunError,
  RunOutputQueryError,
  fetchLatestRunOutput,
  selectEngagementIdFromPathname,
} from "./run-output-query.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("run output query", () => {
  it("selects the engagement id from workspace paths", () => {
    expect(selectEngagementIdFromPathname("/engagements/abc")).toBe("abc");
    expect(
      selectEngagementIdFromPathname("/engagements/abc/anything"),
    ).toBe("abc");
    expect(selectEngagementIdFromPathname("/engagements")).toBeUndefined();
    expect(selectEngagementIdFromPathname("/")).toBeUndefined();
    expect(selectEngagementIdFromPathname("/settings")).toBeUndefined();
  });

  it("returns exact preserved content for a terminal run", async () => {
    const payload = {
      run: {
        id: "run-1",
        actionId: "action-1",
        state: "succeeded",
        terminalKind: "succeeded",
        terminalReason: null,
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
      stdout: {
        present: true,
        artifactId: "artifact-1",
        sizeBytes: 5,
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        completeness: "complete",
        truncated: false,
        content: "hello",
      },
      stderr: { present: false, truncated: false, content: "" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: async () => payload }) as Response),
    );
    await expect(fetchLatestRunOutput("engagement-1")).resolves.toEqual(payload);
  });

  it("maps no_terminal_run to a distinct empty error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ status: 404, json: async () => ({ code: "no_terminal_run" }) }) as Response,
      ),
    );
    await expect(fetchLatestRunOutput("engagement-1")).rejects.toBeInstanceOf(
      NoTerminalRunError,
    );
  });

  it("maps other failures to a query error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchLatestRunOutput("engagement-1")).rejects.toBeInstanceOf(
      RunOutputQueryError,
    );
  });
});
