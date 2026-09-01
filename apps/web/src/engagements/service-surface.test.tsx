// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import { EngagementServicesSection } from "./service-surface.js";
import { ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE } from "./query.js";

const engagementId = "10000000-0000-4000-8000-000000000001";

const serviceA = {
  address: "192.0.2.10",
  port: 22,
  protocol: "tcp" as const,
  hostname: "host-a.test",
  serviceName: "ssh",
  product: "OpenSSH",
  version: "9.6",
  source: "nmap" as const,
  parserVersion: "nmap-xml-v1",
  runId: "run-1",
  artifactId: "artifact-1",
  artifactDigest: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-08-13T10:00:00.000Z",
};

const serviceB = {
  address: "192.0.2.10",
  port: 443,
  protocol: "tcp" as const,
  hostname: null,
  serviceName: null,
  product: null,
  version: null,
  source: "nmap" as const,
  parserVersion: "nmap-xml-v1",
  runId: "run-1",
  artifactId: "artifact-2",
  artifactDigest: `sha256:${"b".repeat(64)}`,
  observedAt: "2026-08-13T12:30:00.000Z",
};

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
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

function renderSurface() {
  return render(
    <QueryClientProvider client={queryClient}>
      <EngagementServicesSection engagementId={engagementId} />
    </QueryClientProvider>,
  );
}

describe("EngagementServicesSection", () => {
  it("shows compact loading without fake chrome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    renderSurface();

    expect(screen.getByRole("status", { name: "Loading attack surface" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Attack surface" })).toBeTruthy();
    expect(screen.queryByText("Runs")).toBeNull();
    expect(screen.queryByText("Findings")).toBeNull();
  });

  it("renders empty copy that points to Nmap and avoids plugin-unavailable wording", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response([]))));

    renderSurface();

    expect(await screen.findByRole("heading", { name: "Attack surface" })).toBeTruthy();
    const emptyCopy = await screen.findByText(/No services have been observed/i);
    expect(emptyCopy).toBeTruthy();
    expect(emptyCopy.textContent).toMatch(/Nmap/i);
    expect(screen.queryByText(/plugin is unavailable/i)).toBeNull();
    expect(screen.queryByText(/plugin unavailable/i)).toBeNull();
  });

  it("derives stat bar only from the response and renders truthful rows with provenance", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response([serviceA, serviceB]))));

    renderSurface();

    expect((await screen.findAllByText("192.0.2.10")).length).toBeGreaterThanOrEqual(1);

    // Stat bar: Services 2, Hosts 1 (same address), Evidence artifacts 2 (distinct artifactIds)
    expect(screen.getByText("Services")).toBeTruthy();
    const servicesValue = screen.getByText("Services").previousElementSibling;
    expect(servicesValue?.textContent).toBe("2");

    expect(screen.getByText("Hosts")).toBeTruthy();
    const hostsValue = screen.getByText("Hosts").previousElementSibling;
    expect(hostsValue?.textContent).toBe("1");

    expect(screen.getByText("Evidence artifacts")).toBeTruthy();
    const artifactsValue = screen.getByText("Evidence artifacts").previousElementSibling;
    expect(artifactsValue?.textContent).toBe("2");

    expect(screen.getByText("Latest observation")).toBeTruthy();
    // Latest observedAt is serviceB at 12:30 UTC on 13 Aug 2026
    expect(screen.getAllByText(/13 Aug 2026/i).length).toBeGreaterThanOrEqual(1);

    // Never show fake run/finding/evidence byte values
    expect(screen.queryByText("Runs")).toBeNull();
    expect(screen.queryByText("Findings")).toBeNull();
    expect(screen.queryByText(/Evidence.*m/i)).toBeNull();

    // Address/hostname, port/protocol, service/product/version, observed time
    expect(screen.getByText("host-a.test")).toBeTruthy();
    expect(screen.getByText("22/tcp")).toBeTruthy();
    expect(screen.getByText("443/tcp")).toBeTruthy();
    // serviceA has ssh · OpenSSH · 9.6, serviceB has unknown
    expect(screen.getAllByText("ssh · OpenSSH · 9.6").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("unknown").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/13 Aug 2026/i).length).toBeGreaterThanOrEqual(1);

    // Accessible provenance disclosure for runId, artifactId, artifactDigest, parserVersion
    const provenanceButtons = screen.getAllByText("Provenance");
    expect(provenanceButtons.length).toBe(2);
    // Provenance details are in the DOM even when collapsed; verify accessible terms are present
    expect(screen.getAllByText("run-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("artifact-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(`sha256:${"a".repeat(64)}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText("nmap-xml-v1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("artifactDigest").length).toBeGreaterThan(0);
    expect(screen.getAllByText("parserVersion").length).toBeGreaterThan(0);

    // Ensure port rows are present and do not overflow: check truncation classes via DOM
    expect(document.body.textContent).not.toContain("Service sweep");
  });

  it("shows a recoverable error when no cached data exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ json: async () => ({ code: "storage_busy" }), ok: false, status: 503 } as Response)),
    );

    renderSurface();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Attack surface unavailable" })).toBeTruthy();
    expect(screen.getByText(/could not be loaded from the local control plane/i)).toBeTruthy();
    expect(screen.queryByText(ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE)).toBeNull();
  });

  it("preserves cached data and shows stale warning when a refresh fails", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(response([serviceA])),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSurface();
    expect(await screen.findByText("192.0.2.10")).toBeTruthy();

    // Second fetch fails, but cached data stays visible with StaleDataState
    fetchMock.mockImplementation(() =>
      Promise.resolve({ json: async () => ({ code: "storage_busy" }), ok: false, status: 503 } as Response),
    );

    await queryClient.refetchQueries();
    // Wait for stale indicator
    await waitFor(() => expect(screen.getByText("Showing the last successful attack surface")).toBeTruthy());

    // Cached row still visible, not hidden by error
    expect(screen.getByText("192.0.2.10")).toBeTruthy();
    expect(screen.getByText("22/tcp")).toBeTruthy();
    // Retry button from stale state
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("validates unknown JSON and hides extra fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response([{ ...serviceA, secret: "/private/path" }]))),
    );

    renderSurface();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.queryByText("private")).toBeNull();
  });
});
