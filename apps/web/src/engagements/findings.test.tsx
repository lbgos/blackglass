// @vitest-environment jsdom

import { ThemeProvider } from "@blackglass/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import { createAppRouter } from "../router.js";

const activeEngagement = {
  contractVersion: 1,
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  name: "Target lab",
  kind: "lab",
  status: "active",
  description: null,
  authorizationContext: null,
  autoContinueWarnings: false,
  activeScopeRevisionId: null,
  deadlineAt: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
};

const readyStatus = { version: 1, overall: "ready", developmentStorage: "ready" };

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

function findingRecord(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    id: "20000000-0000-4000-8000-000000000001",
    engagementId: activeEngagement.id,
    title: "Default credentials",
    severity: "high",
    status: "open",
    body: "# impact\nAdmin access.",
    evidenceArtifactIds: [],
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z",
    ...overrides,
  };
}

const testQueryClients = new Set<QueryClient>();

async function renderWorkspace(initialEntry: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialEntry] }));
  await router.load();
  const queryClient = createAppQueryClient();
  testQueryClients.add(queryClient);
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280, writable: true });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900, writable: true });
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
});

afterEach(() => {
  cleanup();
  for (const client of testQueryClients) client.clear();
  testQueryClients.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("engagement findings", () => {
  it("shows the empty state and creates a finding", async () => {
    let stored: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/system/status")) return Promise.resolve(response(readyStatus));
        if (url === "/api/v1/engagements") return Promise.resolve(response([activeEngagement]));
        if (url === `/api/v1/engagements/${activeEngagement.id}`) {
          return Promise.resolve(
            response({ engagement: activeEngagement, activeScopeRevision: null }),
          );
        }
        if (url.endsWith("/services")) return Promise.resolve(response([]));
        if (url.endsWith("/notes")) {
          return Promise.resolve(
            response({
              engagementId: activeEngagement.id,
              markdown: "",
              updatedAt: "2026-08-12T12:00:00.000Z",
            }),
          );
        }
        if (url.endsWith("/findings") && (init?.method === undefined || init.method === "GET")) {
          return Promise.resolve(response(stored));
        }
        if (url.endsWith("/findings") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          stored = [findingRecord(body)];
          return Promise.resolve(response(stored[0], 201));
        }
        return Promise.resolve(response([]));
      }),
    );

    await renderWorkspace(`/engagements/${activeEngagement.id}?tab=findings`);

    expect(await screen.findByText("No findings yet")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Default credentials" },
    });
    fireEvent.change(screen.getByLabelText("Notes Markdown"), {
      target: { value: "# impact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create finding" }));

    await waitFor(() =>
      expect(screen.getByText("1 open of 1 findings")).toBeTruthy(),
    );
  });

  it("resolves and reopens from the list", async () => {
    let stored = [findingRecord()];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/system/status")) return Promise.resolve(response(readyStatus));
        if (url === "/api/v1/engagements") return Promise.resolve(response([activeEngagement]));
        if (url === `/api/v1/engagements/${activeEngagement.id}`) {
          return Promise.resolve(
            response({ engagement: activeEngagement, activeScopeRevision: null }),
          );
        }
        if (url.endsWith("/services")) return Promise.resolve(response([]));
        if (url.endsWith("/notes")) {
          return Promise.resolve(
            response({
              engagementId: activeEngagement.id,
              markdown: "",
              updatedAt: "2026-08-12T12:00:00.000Z",
            }),
          );
        }
        if (url.endsWith("/findings") && (init?.method === undefined || init.method === "GET")) {
          return Promise.resolve(response(stored));
        }
        if (url.includes("/resolve") && init?.method === "POST") {
          stored = [findingRecord({ status: "resolved" })];
          return Promise.resolve(response(stored[0]));
        }
        if (url.includes("/reopen") && init?.method === "POST") {
          stored = [findingRecord({ status: "open" })];
          return Promise.resolve(response(stored[0]));
        }
        return Promise.resolve(response([]));
      }),
    );

    await renderWorkspace(`/engagements/${activeEngagement.id}?tab=findings`);

    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resolve" })).toBeTruthy(),
    );
  });

  it("shows a truthful error when findings fail to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/system/status")) return Promise.resolve(response(readyStatus));
        if (url === "/api/v1/engagements") return Promise.resolve(response([activeEngagement]));
        if (url === `/api/v1/engagements/${activeEngagement.id}`) {
          return Promise.resolve(
            response({ engagement: activeEngagement, activeScopeRevision: null }),
          );
        }
        if (url.endsWith("/services")) return Promise.resolve(response([]));
        if (url.endsWith("/notes")) {
          return Promise.resolve(
            response({
              engagementId: activeEngagement.id,
              markdown: "",
              updatedAt: "2026-08-12T12:00:00.000Z",
            }),
          );
        }
        if (url.endsWith("/findings")) {
          return Promise.resolve(response({ code: "storage_busy" }, 503));
        }
        return Promise.resolve(response([]));
      }),
    );

    await renderWorkspace(`/engagements/${activeEngagement.id}?tab=findings`);

    expect(await screen.findByText("Findings unavailable")).toBeTruthy();
  });
});
