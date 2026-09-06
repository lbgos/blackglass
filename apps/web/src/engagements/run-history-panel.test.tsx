// @vitest-environment jsdom

import { ThemeProvider } from "@blackglass/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    terminalKind: state === "succeeded" ? "succeeded" : null,
    terminalReason: null,
    updatedAt: createdAt,
    createdAt,
    attempt: 1,
  };
}

function outputFor(runId: string, content: string) {
  return {
    run: {
      id: runId,
      actionId: "action-1",
      state: "succeeded",
      terminalKind: "succeeded",
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
});
