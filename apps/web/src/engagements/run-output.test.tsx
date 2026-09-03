// @vitest-environment jsdom

import { ThemeProvider } from "@blackglass/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import { createAppRouter } from "../router.js";

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

const testQueryClients = new Set<QueryClient>();

async function renderAt(initialEntry: string) {
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
      media: "(min-width: 768px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const client of testQueryClients) client.clear();
  testQueryClients.clear();
});

function engagementList() {
  return [
    {
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
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    },
  ];
}

function engagementDetail() {
  return {
    engagement: engagementList()[0],
    activeScopeRevision: null,
  };
}

describe("console raw output panel", () => {
  it("shows exact preserved stdout and stderr for the latest terminal run", async () => {
    const output = {
      run: {
        id: "run-output-1",
        actionId: "action-1",
        state: "succeeded",
        terminalKind: "succeeded",
        terminalReason: null,
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
      stdout: {
        present: true,
        artifactId: "artifact-stdout",
        sizeBytes: 11,
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        completeness: "complete",
        truncated: false,
        content: "exact-bytes",
      },
      stderr: { present: false, truncated: false, content: "" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/engagements") return response(engagementList());
        if (url === "/api/v1/engagements/10000000-0000-4000-8000-000000000001") {
          return response(engagementDetail());
        }
        if (
          url ===
          "/api/v1/engagements/10000000-0000-4000-8000-000000000001/services"
        ) {
          return response([]);
        }
        if (
          url ===
          "/api/v1/engagements/10000000-0000-4000-8000-000000000001/runs/latest/output"
        ) {
          return response(output);
        }
        if (url === "/api/v1/system/status") {
          return response({ version: 1, overall: "ready", developmentStorage: "ready" });
        }
        return response({ code: "invalid_request" }, 400);
      }),
    );
    await renderAt("/engagements/10000000-0000-4000-8000-000000000001");
    fireEvent.click(screen.getByRole("tab", { name: "Raw output" }));
    await waitFor(() => {
      expect(screen.getByTestId("raw-output-stdout").textContent).toContain("exact-bytes");
    });
    expect(screen.getByText(/No preserved stderr for this run/)).toBeTruthy();
  });

  it("shows the empty state when no terminal run exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/engagements") return response(engagementList());
        if (url === "/api/v1/engagements/10000000-0000-4000-8000-000000000001") {
          return response(engagementDetail());
        }
        if (
          url ===
          "/api/v1/engagements/10000000-0000-4000-8000-000000000001/services"
        ) {
          return response([]);
        }
        if (
          url ===
          "/api/v1/engagements/10000000-0000-4000-8000-000000000001/runs/latest/output"
        ) {
          return response({ code: "no_terminal_run" }, 404);
        }
        if (url === "/api/v1/system/status") {
          return response({ version: 1, overall: "ready", developmentStorage: "ready" });
        }
        return response({ code: "invalid_request" }, 400);
      }),
    );
    await renderAt("/engagements/10000000-0000-4000-8000-000000000001");
    fireEvent.click(screen.getByRole("tab", { name: "Raw output" }));
    await waitFor(() => {
      expect(screen.getByText(/No finished or cancelled runs yet/)).toBeTruthy();
    });
  });

  it("announces truncation truthfully without an em dash", async () => {
    const content = "x".repeat(100);
    const output = {
      run: {
        id: "run-output-2",
        actionId: "action-1",
        state: "failed",
        terminalKind: "failed",
        terminalReason: "runner_lost",
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
      stdout: {
        present: true,
        artifactId: "artifact-big",
        sizeBytes: 70000,
        digest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        completeness: "partial",
        truncated: true,
        content,
      },
      stderr: { present: false, truncated: false, content: "" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/engagements") return response(engagementList());
        if (url === "/api/v1/engagements/10000000-0000-4000-8000-000000000001") {
          return response(engagementDetail());
        }
        if (
          url ===
          "/api/v1/engagements/10000000-0000-4000-8000-000000000001/services"
        ) {
          return response([]);
        }
        if (
          url ===
          "/api/v1/engagements/10000000-0000-4000-8000-000000000001/runs/latest/output"
        ) {
          return response(output);
        }
        if (url === "/api/v1/system/status") {
          return response({ version: 1, overall: "ready", developmentStorage: "ready" });
        }
        return response({ code: "invalid_request" }, 400);
      }),
    );
    await renderAt("/engagements/10000000-0000-4000-8000-000000000001");
    fireEvent.click(screen.getByRole("tab", { name: "Raw output" }));
    await waitFor(() => {
      expect(screen.getByText(/Truncated to the first 65536 bytes/)).toBeTruthy();
    });
    const text = screen.getByTestId("raw-output-stdout").textContent ?? "";
    expect(text).not.toContain("—");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByTestId("raw-output-stdout")).toBeTruthy();
  });
});
