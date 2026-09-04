// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import { ENGAGEMENT_FFUF_RESULTS_QUERY_ERROR_MESSAGE } from "./errors.js";
import { EngagementFfufSection } from "./ffuf-surface.js";

const engagementId = "10000000-0000-4000-8000-000000000001";

const detail = {
  engagement: {
    contractVersion: 1,
    id: engagementId,
    revision: 1,
    name: "Ffuf lab",
    kind: "lab",
    status: "active",
    description: null,
    authorizationContext: null,
  autoContinueWarnings: false,
  activeScopeRevisionId: null,
  deadlineAt: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  },
  activeScopeRevision: null,
};

const ffufResult = {
  source: "ffuf" as const,
  parserVersion: "ffuf-json-v1",
  url: "http://127.0.0.1:3130/planted.txt",
  status: 200,
  length: 10,
  words: 1,
  lines: 2,
  redirectlocation: null,
  fuzz: "planted.txt",
  runId: "run-1",
  artifactId: "artifact-1",
  artifactDigest: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-09-03T00:00:00.000Z",
};

function response(payload: unknown, status = 200): Response {
  return { json: async () => payload, ok: status >= 200 && status < 300, status } as Response;
}

let queryClient: ReturnType<typeof createAppQueryClient>;

beforeEach(() => {
  queryClient = createAppQueryClient();
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
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => Promise.resolve(handler(url))),
  );
}

function renderSurface() {
  return render(
    <QueryClientProvider client={queryClient}>
      <EngagementFfufSection archived={false} engagementId={engagementId} />
    </QueryClientProvider>,
  );
}

describe("EngagementFfufSection", () => {
  it("shows loading state", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    renderSurface();
    expect(screen.getByRole("status", { name: "Loading ffuf discovery" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ffuf discovery" })).toBeTruthy();
  });

  it("renders the launch form with an empty state", async () => {
    stubFetch((url) =>
      url.endsWith("/ffuf-results") ? response([]) : response(detail),
    );
    renderSurface();
    expect(await screen.findByRole("button", { name: "Launch discovery" })).toBeTruthy();
    expect(await screen.findByText(/No ffuf results yet/i)).toBeTruthy();
  });

  it("lists matched paths with status and a raw evidence link", async () => {
    stubFetch((url) =>
      url.endsWith("/ffuf-results") ? response([ffufResult]) : response(detail),
    );
    renderSurface();
    expect(await screen.findByText("http://127.0.0.1:3130/planted.txt")).toBeTruthy();
    expect(await screen.findByText("planted.txt")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Raw evidence" });
    expect(link.getAttribute("href")).toBe(
      `/api/v1/engagements/${engagementId}/artifacts/artifact-1/content`,
    );
  });

  it("shows a recoverable error when results fail", async () => {
    stubFetch((url) =>
      url.endsWith("/ffuf-results")
        ? response({ code: "invalid_persisted_data" }, 500)
        : response(detail),
    );
    renderSurface();
    expect(await screen.findByText("ffuf results unavailable")).toBeTruthy();
    expect(ENGAGEMENT_FFUF_RESULTS_QUERY_ERROR_MESSAGE).toContain("ffuf results");
  });

  it("prefills stored runner defaults into the launch form", async () => {
    stubFetch((url) => {
      if (url.endsWith("/ffuf-results")) return response([]);
      if (url.endsWith("/settings/runner")) {
        return response({
          ffufBinaryPath: "/usr/bin/ffuf",
          ffufWordlistPath: "/lists/default.txt",
          ffufRate: 50,
          ffufThreads: 10,
          ffufTimeoutSeconds: 5,
          ffufMaxTimeSeconds: 60,
        });
      }
      return response(detail);
    });
    renderSurface();
    expect(await screen.findByRole("button", { name: "Launch discovery" })).toBeTruthy();
    expect(await screen.findByDisplayValue("/lists/default.txt")).toBeTruthy();
    expect((screen.getByLabelText("Rate") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Threads") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Timeout s") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Duration s") as HTMLInputElement).value).toBe("60");
  });

  it("falls back to shipped defaults when stored settings fail", async () => {
    stubFetch((url) => {
      if (url.endsWith("/ffuf-results")) return response([]);
      if (url.endsWith("/settings/runner")) {
        return response({ code: "invalid_persisted_data" }, 500);
      }
      return response(detail);
    });
    renderSurface();
    expect(await screen.findByRole("button", { name: "Launch discovery" })).toBeTruthy();
    expect((screen.getByLabelText("Rate") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("Threads") as HTMLInputElement).value).toBe("40");
    expect(await screen.findByText(/Using shipped defaults/)).toBeTruthy();
  });
});
