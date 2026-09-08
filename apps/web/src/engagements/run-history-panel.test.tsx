// @vitest-environment jsdom

import { ThemeProvider } from "@blackglass/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import { RunHistoryPanel } from "./run-history-panel.js";

const ENGAGEMENT_ID = "eng-1";

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

function runSummary(id: string, createdAt: string, state = "succeeded") {
  return {
    id,
    actionId: "action-1",
    state,
    terminalKind:
      state === "succeeded" ? "succeeded" : state === "failed" ? "failed" : state === "cancelled" ? "cancelled" : null,
    terminalReason: null,
    updatedAt: createdAt,
    createdAt,
    attempt: 1,
  };
}

function outputFor(runId: string, content: string, state = "succeeded") {
  return {
    run: {
      id: runId,
      actionId: "action-1",
      state,
      terminalKind: state,
      terminalReason: null,
      updatedAt: "2026-08-09T12:00:00.000Z",
    },
    stdout: {
      present: true,
      artifactId: `artifact-${runId}`,
      sizeBytes: content.length,
      digest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      completeness: "complete",
      truncated: false,
      content,
    },
    stderr: { present: false, truncated: false, content: "" },
  };
}

const testQueryClients = new Set<QueryClient>();

function renderPanel(props: {
  engagementId?: string;
  selectedRunId?: string | undefined;
  onSelect?: (runId: string) => void;
}) {
  const queryClient = createAppQueryClient();
  testQueryClients.add(queryClient);
  const onSelect = props.onSelect ?? vi.fn();
  const view = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RunHistoryPanel
          engagementId={props.engagementId ?? ENGAGEMENT_ID}
          selectedRunId={props.selectedRunId}
          onSelect={onSelect}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...view, onSelect, queryClient };
}

function fetchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

function assertReadOnly(fetchMock: ReturnType<typeof vi.fn>): void {
  for (const call of fetchMock.mock.calls) {
    const init = call[1] as RequestInit | undefined;
    expect(init?.method ?? "GET").toBe("GET");
  }
  const urls = fetchUrls(fetchMock);
  expect(urls.some((url) => /\/actions/.test(url))).toBe(false);
  expect(urls.some((url) => /cancel|retry|continue|add-scope/.test(url))).toBe(false);
}

function historyGetCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchUrls(fetchMock).filter((url) => url.includes("/runs?")).length;
}

function outputGetCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchUrls(fetchMock).filter((url) => /\/runs\/[^/]+\/output$/.test(url)).length;
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  for (const client of testQueryClients) client.clear();
  testQueryClients.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("run history panel", () => {
  it("keeps caller selection stable and loads exact output for the selected run", async () => {
    const historyPage = {
      runs: [
        runSummary("run-new", "2026-08-10T12:00:00.000Z"),
        runSummary("run-old", "2026-08-09T12:00:00.000Z"),
      ],
      nextCursor: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/runs/run-old/output")) return response(outputFor("run-old", "exact-old-bytes"));
      if (url.includes("/runs?")) return response(historyPage);
      return response({ code: "invalid_request" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSelect = vi.fn();
    const { queryClient, rerender } = renderPanel({ onSelect, selectedRunId: "run-old" });

    const newest = await screen.findByRole("button", { name: /run-new/ });
    const oldest = await screen.findByRole("button", { name: /run-old/ });
    expect(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(oldest.getAttribute("aria-current")).toBe("true");
    expect(newest.getAttribute("aria-current")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("run-history-stdout").textContent).toBe("exact-old-bytes");
    });
    expect(fetchUrls(fetchMock)).toContain(
      `/api/v1/engagements/${ENGAGEMENT_ID}/runs/run-old/output`,
    );
    expect(fetchUrls(fetchMock).some((url) => url.endsWith("/runs/latest/output"))).toBe(false);

    fireEvent.click(newest);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("run-new");

    rerender(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RunHistoryPanel
            engagementId={ENGAGEMENT_ID}
            selectedRunId="run-old"
            onSelect={onSelect}
          />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("run-history-stdout").textContent).toBe("exact-old-bytes");
    });
    expect(fetchUrls(fetchMock).some((url) => url.endsWith("/runs/run-new/output"))).toBe(false);

    assertReadOnly(fetchMock);
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("pages with Load more using the opaque cursor", async () => {
    const first = {
      runs: [runSummary("run-new", "2026-08-10T12:00:00.000Z")],
      nextCursor: "cursor-1",
    };
    const second = {
      runs: [runSummary("run-old", "2026-08-09T12:00:00.000Z")],
      nextCursor: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("before=cursor-1")) return response(second);
      if (url.includes("/runs?")) return response(first);
      if (url.endsWith("/output")) return response(outputFor("run-new", "new-bytes"));
      return response({ code: "invalid_request" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel({ selectedRunId: undefined });

    await screen.findByRole("button", { name: /run-new/ });
    expect(screen.getByText(/1 run shown/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /run-old/ })).toBeTruthy();
    });
    expect(screen.getByText(/2 runs shown/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(fetchUrls(fetchMock).some((url) => url.includes("before=cursor-1"))).toBe(true);
    assertReadOnly(fetchMock);
  });

  it("shows loading, empty, and recoverable error states with retry", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/runs?")) return new Promise<Response>(() => undefined);
      return response({ code: "invalid_request" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel({ selectedRunId: undefined });
    expect(screen.getByRole("status", { name: "Loading run history" })).toBeTruthy();
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) return response({ runs: [], nextCursor: null });
        return response({ code: "invalid_request" }, 400);
      }),
    );
    renderPanel({ selectedRunId: undefined });
    expect(await screen.findByText("No runs yet")).toBeTruthy();
    expect(screen.getByText(/Select a run to view its exact preserved output/)).toBeTruthy();
    cleanup();

    const retryMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/runs?")) return response({ code: "storage_busy" }, 503);
      return response({ code: "invalid_request" }, 400);
    });
    vi.stubGlobal("fetch", retryMock);
    renderPanel({ selectedRunId: undefined });
    expect(await screen.findByText("Run history unavailable")).toBeTruthy();
    const before = retryMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryMock.mock.calls.length).toBeGreaterThan(before));
    assertReadOnly(retryMock);
  });

  it("maps an unknown selected run to a distinct unavailable state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/runs?")) {
        return response({
          runs: [runSummary("run-old", "2026-08-09T12:00:00.000Z")],
          nextCursor: null,
        });
      }
      if (url.endsWith("/runs/run-missing/output")) {
        return response({ code: "run_not_found" }, 404);
      }
      return response({ code: "invalid_request" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel({ selectedRunId: "run-missing" });
    expect(await screen.findByText("Run unavailable")).toBeTruthy();
    expect(screen.getByText(/That run is no longer available/)).toBeTruthy();
    assertReadOnly(fetchMock);
  });

  it("shows pending for a listed running run without fetching its output", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/is still running/)).toBeTruthy();
      expect(screen.getByText(/Auto-checking every 2 seconds/)).toBeTruthy();
      expect(screen.queryByText("Run unavailable")).toBeNull();
      expect(outputGetCount(fetchMock)).toBe(0);
      expect(historyGetCount(fetchMock)).toBe(1);
      assertReadOnly(fetchMock);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-checks at most 30 times, then pauses without touching output", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      expect(historyGetCount(fetchMock)).toBe(1);
      await vi.advanceTimersByTimeAsync(70_000);
      expect(historyGetCount(fetchMock)).toBe(31);
      expect(screen.getByText(/Auto-check paused after 30 checks/)).toBeTruthy();
      expect(outputGetCount(fetchMock)).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(historyGetCount(fetchMock)).toBe(31);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refresh restarts the poll budget after pausing", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(62_000);
      expect(historyGetCount(fetchMock)).toBe(31);
      expect(screen.getByText(/Auto-check paused after 30 checks/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(historyGetCount(fetchMock)).toBe(32);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(historyGetCount(fetchMock)).toBe(34);
      expect(screen.getByText(/Auto-checking every 2 seconds/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches exact output once the listed row turns terminal", async () => {
    vi.useFakeTimers();
    try {
      let historyCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          historyCalls += 1;
          const state = historyCalls < 3 ? "running" : "succeeded";
          return response({
            runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", state)],
            nextCursor: null,
          });
        }
        if (url.endsWith("/runs/run-1/output")) return response(outputFor("run-1", "final-bytes"));
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/is still running/)).toBeTruthy();
      await vi.advanceTimersByTimeAsync(4_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(outputGetCount(fetchMock)).toBe(1);
      expect(fetchUrls(fetchMock)).toContain(`/api/v1/engagements/${ENGAGEMENT_ID}/runs/run-1/output`);
      expect(screen.getByTestId("run-history-stdout").textContent).toBe("final-bytes");
      expect(screen.queryByText(/is still/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps unknown selected ids on the unavailable path without pending", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/runs?")) {
        return response({
          runs: [runSummary("run-old", "2026-08-09T12:00:00.000Z")],
          nextCursor: null,
        });
      }
      if (url.endsWith("/runs/run-missing/output")) {
        return response({ code: "run_not_found" }, 404);
      }
      return response({ code: "invalid_request" }, 400);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel({ selectedRunId: "run-missing" });
    expect(await screen.findByText("Run unavailable")).toBeTruthy();
    expect(screen.queryByText(/is still/)).toBeNull();
    expect(outputGetCount(fetchMock)).toBe(1);
  });

  it("does not auto-poll once a second page is loaded", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("before=cursor-1")) {
          return response({
            runs: [runSummary("run-old", "2026-08-09T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-new", "2026-08-10T12:00:00.000Z")],
            nextCursor: "cursor-1",
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-old" });
      await vi.advanceTimersByTimeAsync(0);
      // Selected id is beyond the loaded window, so the exact path applies.
      expect(outputGetCount(fetchMock)).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/is still running/)).toBeTruthy();
      const loaded = historyGetCount(fetchMock);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(historyGetCount(fetchMock)).toBe(loaded);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(historyGetCount(fetchMock)).toBe(loaded + 1);
      expect(outputGetCount(fetchMock)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to exact fetch when the selected row disappears", async () => {
    vi.useFakeTimers();
    try {
      let historyCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          historyCalls += 1;
          if (historyCalls === 1) {
            return response({
              runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
              nextCursor: null,
            });
          }
          return response({ runs: [], nextCursor: null });
        }
        if (url.endsWith("/runs/run-1/output")) {
          return response({ code: "run_not_found" }, 404);
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/is still running/)).toBeTruthy();
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText("Run unavailable")).toBeTruthy();
      expect(outputGetCount(fetchMock)).toBe(1);
      const settled = historyGetCount(fetchMock);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(historyGetCount(fetchMock)).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts polling from the history retry after an error", async () => {
    vi.useFakeTimers();
    try {
      let historyCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          historyCalls += 1;
          if (historyCalls === 2) return response({ code: "storage_busy" }, 503);
          return response({
            runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(screen.getByText(/Showing the last successful run history/)).toBeTruthy();
      fireEvent.click(
        within(screen.getByLabelText("Selected run output")).getByRole("button", {
          name: "Refresh",
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Auto-checking every 2 seconds/)).toBeTruthy();
      const restarted = historyGetCount(fetchMock);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(historyGetCount(fetchMock)).toBe(restarted + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects late completions from a previous selection without corrupting the budget", async () => {
    vi.useFakeTimers();
    try {
      let resolveSecond!: (value: Response) => void;
      let historyCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          historyCalls += 1;
          if (historyCalls === 1) {
            return response({
              runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
              nextCursor: null,
            });
          }
          if (historyCalls === 2) {
            return new Promise<Response>((resolve) => {
              resolveSecond = resolve;
            });
          }
          return response({
            runs: [runSummary("run-2", "2026-08-10T12:01:00.000Z", "running")],
            nextCursor: null,
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      const queryClient = createAppQueryClient();
      testQueryClients.add(queryClient);
      const view = render(
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <RunHistoryPanel
              engagementId={ENGAGEMENT_ID}
              selectedRunId="run-1"
              onSelect={() => undefined}
            />
          </QueryClientProvider>
        </ThemeProvider>,
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(historyCalls).toBe(2);
      view.rerender(
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <RunHistoryPanel
              engagementId={ENGAGEMENT_ID}
              selectedRunId="run-2"
              onSelect={() => undefined}
            />
          </QueryClientProvider>
        </ThemeProvider>,
      );
      // The previous session's fetch resolves late with current server data.
      // It must not consume the new session's budget or block its lock.
      expect(resolveSecond).toBeDefined();
      resolveSecond(
        response({
          runs: [runSummary("run-2", "2026-08-10T12:01:00.000Z", "running")],
          nextCursor: null,
        }),
      );
      await vi.advanceTimersByTimeAsync(6_000);
      expect(historyGetCount(fetchMock)).toBe(5);
      expect(screen.getByText(/Auto-checking every 2 seconds/)).toBeTruthy();
      // The only output call is the exact fetch from before the late data
      // arrived, when run-2 was not yet in the loaded window.
      expect(outputGetCount(fetchMock)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts more than 30 automatic checks with slow responses", async () => {
    vi.useFakeTimers();
    try {
      let historyCalls = 0;
      let inFlight = 0;
      let maxInFlight = 0;
      const waiting: Array<(value: Response) => void> = [];
      const runningPage = () =>
        response({
          runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
          nextCursor: null,
        });
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          historyCalls += 1;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          if (historyCalls === 1) {
            inFlight -= 1;
            return runningPage();
          }
          return new Promise<Response>((resolve) => {
            waiting.push((value) => {
              inFlight -= 1;
              resolve(value);
            });
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      for (let round = 0; round < 40; round += 1) {
        await vi.advanceTimersByTimeAsync(2_000);
        const resolve = waiting.shift();
        if (resolve !== undefined) resolve(runningPage());
      }
      expect(historyGetCount(fetchMock)).toBe(31);
      expect(maxInFlight).toBe(1);
      expect(screen.getByText(/Auto-check paused after 30 checks/)).toBeTruthy();
      expect(outputGetCount(fetchMock)).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(historyGetCount(fetchMock)).toBe(31);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the 2s cadence and budget synchronously on selection change", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          return response({
            runs: [
              runSummary("run-1", "2026-08-10T12:00:00.000Z", "running"),
              runSummary("run-2", "2026-08-10T12:01:00.000Z", "running"),
            ],
            nextCursor: null,
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      const queryClient = createAppQueryClient();
      testQueryClients.add(queryClient);
      const view = render(
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <RunHistoryPanel
              engagementId={ENGAGEMENT_ID}
              selectedRunId="run-1"
              onSelect={() => undefined}
            />
          </QueryClientProvider>
        </ThemeProvider>,
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(62_000);
      expect(historyGetCount(fetchMock)).toBe(31);
      expect(screen.getByText(/Auto-check paused after 30 checks/)).toBeTruthy();
      view.rerender(
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <RunHistoryPanel
              engagementId={ENGAGEMENT_ID}
              selectedRunId="run-2"
              onSelect={() => undefined}
            />
          </QueryClientProvider>
        </ThemeProvider>,
      );
      // No render lag: the fresh session paints its own budget immediately.
      expect(screen.getByText(/check 1 of 30/)).toBeTruthy();
      await vi.advanceTimersByTimeAsync(200);
      expect(historyGetCount(fetchMock)).toBe(31);
      await vi.advanceTimersByTimeAsync(1_800);
      expect(historyGetCount(fetchMock)).toBe(32);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the exact stop reason and never claims checking while inactive", async () => {
    vi.useFakeTimers();
    try {
      let historyCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          historyCalls += 1;
          if (historyCalls === 2) return response({ code: "storage_busy" }, 503);
          return response({
            runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(screen.getByText(/Auto-check paused: history request failed/)).toBeTruthy();
      expect(screen.queryByText(/Auto-checking/)).toBeNull();
      expect(screen.queryByText(/after 30 checks/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    cleanup();

    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("before=cursor-1")) {
          return response({
            runs: [runSummary("run-old", "2026-08-09T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-new", "2026-08-10T12:00:00.000Z")],
            nextCursor: "cursor-1",
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-old" });
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Auto-check paused: more than one page loaded/)).toBeTruthy();
      expect(screen.queryByText(/Auto-checking/)).toBeNull();
      expect(screen.queryByText(/after 30 checks/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    cleanup();

    vi.useFakeTimers();
    try {
      let resolveNext!: (value: Response) => void;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("before=cursor-1")) {
          return new Promise<Response>((resolve) => {
            resolveNext = resolve;
          });
        }
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-new", "2026-08-10T12:00:00.000Z", "running")],
            nextCursor: "cursor-1",
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-new" });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Auto-checking every 2 seconds/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Loading more history/)).toBeTruthy();
      expect(screen.queryByText(/Auto-checking/)).toBeNull();
      expect(screen.queryByText(/after 30 checks/)).toBeNull();
      expect(resolveNext).toBeDefined();
      resolveNext(
        response({
          runs: [runSummary("run-old", "2026-08-09T12:00:00.000Z", "running")],
          nextCursor: null,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Auto-check paused: more than one page loaded/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a failed load-more through manual refresh", async () => {
    vi.useFakeTimers();
    try {
      let nextCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("before=cursor-1")) {
          nextCalls += 1;
          if (nextCalls === 1) return response({ code: "storage_busy" }, 503);
          return response({
            runs: [runSummary("run-old", "2026-08-09T12:00:00.000Z", "running")],
            nextCursor: null,
          });
        }
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-new", "2026-08-10T12:00:00.000Z", "running")],
            nextCursor: "cursor-1",
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-new" });
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Auto-checking every 2 seconds/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Auto-check paused: history request failed/)).toBeTruthy();
      expect(screen.queryByText(/Auto-checking/)).toBeNull();
      fireEvent.click(
        within(screen.getByLabelText("Selected run output")).getByRole("button", {
          name: "Refresh",
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/Auto-checking every 2 seconds/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling on unmount, even with a request in flight", async () => {
    vi.useFakeTimers();
    try {
      let resolvePending!: (value: Response) => void;
      let historyCalls = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          historyCalls += 1;
          if (historyCalls === 1) {
            return response({
              runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
              nextCursor: null,
            });
          }
          return new Promise<Response>((resolve) => {
            resolvePending = resolve;
          });
        }
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      const queryClient = createAppQueryClient();
      testQueryClients.add(queryClient);
      const view = render(
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <RunHistoryPanel
              engagementId={ENGAGEMENT_ID}
              selectedRunId="run-1"
              onSelect={() => undefined}
            />
          </QueryClientProvider>
        </ThemeProvider>,
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(historyCalls).toBe(2);
      view.unmount();
      expect(resolvePending).toBeDefined();
      resolvePending(
        response({
          runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", "running")],
          nextCursor: null,
        }),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(historyGetCount(fetchMock)).toBe(2);
      expect(outputGetCount(fetchMock)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders pending for every non-terminal state", async () => {
    for (const state of ["queued", "leased", "running", "cancel_requested"]) {
      vi.useFakeTimers();
      try {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/runs?")) {
            return response({
              runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", state)],
              nextCursor: null,
            });
          }
          return response({ code: "invalid_request" }, 400);
        });
        vi.stubGlobal("fetch", fetchMock);
        renderPanel({ selectedRunId: "run-1" });
        await vi.advanceTimersByTimeAsync(0);
        expect(screen.getByText(new RegExp(`is still ${state}`))).toBeTruthy();
        expect(outputGetCount(fetchMock)).toBe(0);
      } finally {
        vi.useRealTimers();
      }
      cleanup();
    }
  });

  it("uses the output path for every terminal state", async () => {
    for (const state of ["succeeded", "failed", "cancelled"]) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/runs?")) {
          return response({
            runs: [runSummary("run-1", "2026-08-10T12:00:00.000Z", state)],
            nextCursor: null,
          });
        }
        if (url.endsWith("/runs/run-1/output")) return response(outputFor("run-1", "terminal-bytes", state));
        return response({ code: "invalid_request" }, 400);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPanel({ selectedRunId: "run-1" });
      await screen.findByTestId("run-history-stdout");
      expect(screen.getByTestId("run-history-stdout").textContent).toBe("terminal-bytes");
      expect(screen.getByText(`run-1 · ${state}`)).toBeTruthy();
      expect(screen.queryByText(/is still/)).toBeNull();
      expect(outputGetCount(fetchMock)).toBe(1);
      cleanup();
    }
  });
});
