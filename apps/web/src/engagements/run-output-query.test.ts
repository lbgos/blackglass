import { describe, expect, it, vi, afterEach } from "vitest";
import { skipToken } from "@tanstack/react-query";

import { createAppQueryClient } from "../query-client.js";
import {
  NoTerminalRunError,
  RunNotFoundError,
  RunOutputQueryError,
  fetchLatestRunOutput,
  fetchRunOutput,
  latestRunOutputQueryKey,
  runOutputQueryKey,
  runOutputQueryOptions,
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

describe("selected run output query", () => {
  const output = {
    run: {
      id: "run-old",
      actionId: "action-1",
      state: "failed",
      terminalKind: "failed",
      terminalReason: null,
      updatedAt: "2026-08-08T12:00:00.000Z",
    },
    stdout: { present: false, truncated: false, content: "" },
    stderr: { present: false, truncated: false, content: "" },
  };

  it("fetches the selected run through its exact endpoint with an abort signal", async () => {
    const fetchMock = vi.fn(
      async () => ({ status: 200, json: async () => output }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createAppQueryClient();

    await expect(
      client.fetchQuery(runOutputQueryOptions("eng-1", "run-old")),
    ).resolves.toEqual(output);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/engagements/eng-1/runs/run-old/output",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(runOutputQueryOptions("eng-1", "run-old").queryKey).toEqual(
      runOutputQueryKey("eng-1", "run-old"),
    );
    client.clear();
  });

  it("keeps the latest endpoint unchanged and isolates keys per engagement and run", async () => {
    const fetchMock = vi.fn(
      async () => ({ status: 200, json: async () => output }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchRunOutput("eng-1", "run-old");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/engagements/eng-1/runs/run-old/output",
      undefined,
    );
    await fetchLatestRunOutput("eng-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/engagements/eng-1/runs/latest/output",
      undefined,
    );

    expect(runOutputQueryKey("eng-1", "run-old")).toEqual([
      "engagements",
      "eng-1",
      "runs",
      "run-old",
      "output",
    ]);
    expect(runOutputQueryKey("eng-1", "run-old")).not.toEqual(
      latestRunOutputQueryKey("eng-1"),
    );
    expect(runOutputQueryKey("eng-1", "run-old")).not.toEqual(
      runOutputQueryKey("eng-1", "run-new"),
    );
    expect(runOutputQueryKey("eng-1", "run-old")).not.toEqual(
      runOutputQueryKey("eng-2", "run-old"),
    );
  });

  it("encodes engagement and run ids without changing the route shape", async () => {
    const fetchMock = vi.fn(
      async () => ({ status: 200, json: async () => output }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchRunOutput("eng/1", "run/old");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/engagements/eng%2F1/runs/run%2Fold/output",
      undefined,
    );
  });

  it("maps an unknown or foreign run to a distinct error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ status: 404, json: async () => ({ code: "run_not_found" }) }) as Response,
      ),
    );
    await expect(fetchRunOutput("eng-1", "run-old")).rejects.toBeInstanceOf(
      RunNotFoundError,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ status: 404, json: async () => ({ code: "engagement_not_found" }) }) as Response,
      ),
    );
    await expect(fetchRunOutput("eng-1", "run-old")).rejects.toBeInstanceOf(
      RunOutputQueryError,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ status: 200, json: async () => ({ run: { id: "run-old" } }) }) as Response,
      ),
    );
    await expect(fetchRunOutput("eng-1", "run-old")).rejects.toBeInstanceOf(
      RunOutputQueryError,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("GET /api?token=secret failed");
      }),
    );
    const error: unknown = await fetchRunOutput("eng-1", "run-old").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(RunOutputQueryError);
    if (!(error instanceof Error)) throw new Error("Expected an error instance.");
    expect(error.message).not.toContain("secret");
    expect(error.cause).toBeUndefined();
  });

  it("rethrows cancellation instead of a safe error when the selected query is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abortError;
      }),
    );

    await expect(fetchRunOutput("eng-1", "run-old", controller.signal)).rejects.toBe(
      abortError,
    );
  });

  it("never fetches when no run is selected", () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => output }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(runOutputQueryOptions("eng-1", undefined).queryFn).toBe(skipToken);
    expect(runOutputQueryOptions(undefined, "run-old").queryFn).toBe(skipToken);
    expect(runOutputQueryOptions("eng-1", "").queryFn).toBe(skipToken);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
