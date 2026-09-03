// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import { ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE } from "./errors.js";
import { EngagementServicesSection } from "./service-surface.js";

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
  observedAt: "2026-08-13T12:00:00.000+02:00",
};

const serviceB = {
  address: "192.0.2.2",
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
  observedAt: "2026-08-13T11:00:00.000Z",
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

function renderSurface() {
  return render(
    <QueryClientProvider client={queryClient}>
      <EngagementServicesSection engagementId={engagementId} />
    </QueryClientProvider>,
  );
}

describe("EngagementServicesSection", () => {
  it("shows compact loading without fake counters", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    renderSurface();
    expect(screen.getByRole("status", { name: "Loading attack surface" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Attack surface" })).toBeTruthy();
    expect(screen.queryByText("Runs")).toBeNull();
  });

  it("renders empty with truthful zeros and Nmap copy", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response([]))));
    renderSurface();
    expect(await screen.findByRole("heading", { name: "Attack surface" })).toBeTruthy();
    expect(await screen.findByText(/No services have been observed/i)).toBeTruthy();
    expect(screen.getByText("Services").previousElementSibling?.textContent).toBe("0");
    expect(screen.getByText("Hosts").previousElementSibling?.textContent).toBe("0");
    expect(screen.getByText("Evidence artifacts").previousElementSibling?.textContent).toBe("0");
    expect(screen.getByText("Latest observation")).toBeTruthy();
    expect(screen.queryByText("Runs")).toBeNull();
  });

  it("derives truthful stats and renders deduplicated identity with provenance", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response([serviceA, serviceB]))));
    renderSurface();
    const addresses = (await screen.findAllByText(/192\.0\.2\./)).map((element) => element.textContent);
    expect(addresses[0]).toBe("192.0.2.2");
    expect(addresses[1]).toBe("192.0.2.10");
    expect(screen.getByText("Services").previousElementSibling?.textContent).toBe("2");
    expect(screen.getByText("Hosts").previousElementSibling?.textContent).toBe("2");
    expect(screen.getByText("Evidence artifacts").previousElementSibling?.textContent).toBe("2");
    expect(screen.getByText("Latest observation").previousElementSibling?.textContent).toMatch(/11:00/);
    expect(screen.getAllByText(/13 Aug 2026/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("host-a.test")).toBeTruthy();
    expect(screen.getByText("22/tcp")).toBeTruthy();
    expect(screen.getByText("443/tcp")).toBeTruthy();
    expect(screen.getByText("OpenSSH 9.6")).toBeTruthy();
    expect(screen.getAllByText("ssh").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("unknown").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Provenance").length).toBe(2);
    expect(screen.getAllByText("run-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(`sha256:${"a".repeat(64)}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText("artifactDigest").length).toBeGreaterThan(0);
  });

  it("links each service row to its source XML evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response([serviceA, serviceB]))));
    renderSurface();
    const links = await screen.findAllByRole("link", { name: "XML" });
    expect(links).toHaveLength(2);
    const hrefs = links.map((link) => link.getAttribute("href")).sort();
    expect(hrefs).toEqual(
      [
        `/api/v1/engagements/${engagementId}/artifacts/artifact-1/content`,
        `/api/v1/engagements/${engagementId}/artifacts/artifact-2/content`,
      ].sort(),
    );
    for (const link of links) {
      expect(link.hasAttribute("download")).toBe(true);
    }
  });

  it("shows recoverable error without cached data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ json: async () => ({ code: "storage_busy" }), ok: false, status: 503 } as Response)),
    );
    renderSurface();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Attack surface unavailable" })).toBeTruthy();
    expect(screen.queryByText(ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE)).toBeNull();
  });

  it("preserves cached data with stale warning on refresh failure", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response([serviceA])));
    vi.stubGlobal("fetch", fetchMock);
    renderSurface();
    expect(await screen.findByText("192.0.2.10")).toBeTruthy();
    fetchMock.mockImplementation(
      () => Promise.resolve({ json: async () => ({ code: "storage_busy" }), ok: false, status: 503 } as Response),
    );
    await queryClient.refetchQueries();
    await waitFor(() => expect(screen.getByText("Showing the last successful attack surface")).toBeTruthy());
    expect(screen.getByText("192.0.2.10")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("validates untrusted JSON and hides secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response([{ ...serviceA, secret: "/private/path" }]))));
    renderSurface();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.queryByText("private")).toBeNull();
  });
});
