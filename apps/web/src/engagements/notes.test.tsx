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

describe("engagement notes", () => {
  it("loads an empty scratchpad, tracks dirt, and saves explicitly", async () => {
    let stored = "";
    const puts: unknown[] = [];
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
        if (url.endsWith("/notes") && (init?.method === undefined || init.method === "GET")) {
          return Promise.resolve(
            response({
              engagementId: activeEngagement.id,
              markdown: stored,
              updatedAt: "2026-08-12T12:00:00.000Z",
            }),
          );
        }
        if (url.endsWith("/notes") && init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { markdown: string };
          puts.push(body);
          stored = body.markdown;
          return Promise.resolve(
            response({
              engagementId: activeEngagement.id,
              markdown: stored,
              updatedAt: "2026-08-12T12:01:00.000Z",
            }),
          );
        }
        return Promise.resolve(response([]));
      }),
    );

    await renderWorkspace(`/engagements/${activeEngagement.id}`);

    const editor = (await screen.findByLabelText("Markdown")) as HTMLTextAreaElement;
    expect(editor.value).toBe("");
    const save = screen.getByRole("button", { name: "Save notes" });
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Saved")).toBeTruthy();

    fireEvent.change(editor, { target: { value: "# creds\nadmin / secret" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(save.hasAttribute("disabled")).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(puts).toEqual([{ markdown: "# creds\nadmin / secret" }]);
    expect((screen.getByLabelText("Markdown") as HTMLTextAreaElement).value).toBe(
      "# creds\nadmin / secret",
    );
  });

  it("shows a truthful error when saving fails", async () => {
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
          if (init?.method === "PUT") {
            return Promise.resolve(response({ code: "storage_busy" }, 503));
          }
          return Promise.resolve(
            response({
              engagementId: activeEngagement.id,
              markdown: "",
              updatedAt: "2026-08-12T12:00:00.000Z",
            }),
          );
        }
        return Promise.resolve(response([]));
      }),
    );

    await renderWorkspace(`/engagements/${activeEngagement.id}`);

    const editor = await screen.findByLabelText("Markdown");
    fireEvent.change(editor, { target: { value: "# observations" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));

    expect(await screen.findByText("Storage is busy. Try again.")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
});
