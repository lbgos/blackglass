// @vitest-environment jsdom

import { ThemeProvider } from "@blackglass/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportBundle } from "@blackglass/contracts";
import { createAppQueryClient } from "../query-client.js";
import { EngagementReportSection } from "./report.js";

const engagementId = "10000000-0000-4000-8000-000000000001";

function bundleFixture(): ReportBundle {
  return {
    contractVersion: 1,
    engagement: {
      id: engagementId,
      name: "Target lab",
      kind: "lab",
      status: "active",
      description: null,
      authorizationContext: null,
      deadlineAt: null,
      revision: 1,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    },
    findings: [
      {
        contractVersion: 1,
        id: "20000000-0000-4000-8000-000000000001",
        engagementId,
        title: "Default credentials on admin panel",
        severity: "high",
        status: "open",
        body: "# impact\nAdmin access.",
        evidenceArtifactIds: [],
        createdAt: "2026-08-12T12:00:00.000Z",
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
    ],
    notesMarkdown: "# creds\nadmin:admin",
    notesUpdatedAt: "2026-08-12T12:00:00.000Z",
    services: { total: 0, truncated: false, rows: [] },
    probes: { total: 0, truncated: false, rows: [] },
    ffufResults: { total: 0, truncated: false, rows: [] },
    evidenceArtifacts: { total: 0, truncated: false, rows: [] },
    generatedAt: "2026-08-12T13:00:00.000Z",
  };
}

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    text: async () =>
      typeof payload === "string" ? payload : JSON.stringify(payload),
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

const testQueryClients = new Set<QueryClient>();

function renderSection() {
  const queryClient = createAppQueryClient();
  testQueryClients.add(queryClient);
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <EngagementReportSection engagementId={engagementId} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }),
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:fake-report"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  for (const client of testQueryClients) client.clear();
  testQueryClients.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("engagement report", () => {
  it("renders the preview and copies markdown with confirmation", async () => {
    const bundle = bundleFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).endsWith("/report")) {
          return Promise.resolve(response(bundle));
        }
        return Promise.reject(new Error("unexpected fetch"));
      }),
    );
    const clicked: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(`${this.download}:${this.href}`);
      });

    renderSection();

    expect(await screen.findByText(/1 findings/)).toBeTruthy();
    expect(screen.getByText(/Default credentials on admin panel/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() =>
      expect(window.navigator.clipboard.writeText).toHaveBeenCalled(),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    const copied = String(
      (window.navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "",
    );
    expect(copied).toContain("Default credentials on admin panel");

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    expect(clicked.some((entry) => entry.startsWith(`engagement-${engagementId}-report.json:`))).toBe(
      true,
    );
    clickSpy.mockRestore();
  });

  it("downloads markdown from the cached bundle without hitting the markdown endpoint", async () => {
    const bundle = bundleFixture();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/report?format=markdown")) {
        return Promise.reject(new Error("markdown endpoint must not be used for export"));
      }
      if (url.endsWith("/report")) return Promise.resolve(response(bundle));
      return Promise.reject(new Error("unexpected fetch"));
    });
    vi.stubGlobal("fetch", fetchMock);
    const clicked: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(`${this.download}:${this.href}`);
      });

    renderSection();
    expect(await screen.findByRole("button", { name: "Download Markdown" })).toBeTruthy();
    // Preview and export share one bundle-derived snapshot.
    expect(screen.getByText(/Default credentials on admin panel/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    await waitFor(() =>
      expect(
        clicked.some((entry) =>
          entry.startsWith(`engagement-${engagementId}-report.md:`),
        ),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(([called]) => String(called).endsWith("/report?format=markdown")),
    ).toBe(false);
    clickSpy.mockRestore();
  });

  it("shows the empty state and the error state", async () => {
    const empty: ReportBundle = {
      ...bundleFixture(),
      findings: [],
      notesMarkdown: "",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response(empty))),
    );
    renderSection();
    expect(await screen.findByText("Nothing to report yet")).toBeTruthy();
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response({ code: "oops" }, 500))),
    );
    const queryClient = createAppQueryClient();
    testQueryClients.add(queryClient);
    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <EngagementReportSection engagementId={engagementId} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText("Report unavailable")).toBeTruthy();
  });
});
