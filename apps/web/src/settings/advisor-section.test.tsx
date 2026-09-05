// @vitest-environment jsdom
import { ADVISOR_SETTINGS_DEFAULTS } from "@blackglass/contracts";
import { ThemeProvider } from "@blackglass/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import { createAppRouter } from "../router.js";
import { SettingsPage } from "./page.js";
import { SettingsViewProvider, useSettingsView } from "./settings-view.js";

const stored = {
  endpointBaseUrl: "http://127.0.0.1:11434/v1",
  modelId: "qwen3:8b",
  apiKeyEnvVar: "BLACKGLASS_ADVISOR_API_KEY",
  requestBudget: 25,
  rawResponseVisibility: false,
  publicEndpointOptIn: true,
};

const okStatus = {
  configured: true,
  endpointReachable: true,
  modelId: "qwen3:8b",
  endpointHost: "127.0.0.1",
  publicEndpoint: false,
  optIn: true,
  keyEnvVar: "BLACKGLASS_ADVISOR_API_KEY",
  keyPresent: true,
  latencyMs: 12,
  reason: "ok",
};

function response(payload: unknown, status = 200): Response {
  return { json: async () => payload, ok: status >= 200 && status < 300, status } as Response;
}

let queryClient: ReturnType<typeof createAppQueryClient>;
let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(putImpl?: (body: Record<string, unknown>) => Response) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/v1/advisor/status")) return Promise.resolve(response(okStatus));
    if (String(url).includes("/api/v1/settings/advisor")) {
      if (init?.method === "PUT") {
        if (putImpl) return Promise.resolve(putImpl(JSON.parse(String(init.body))));
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(response({ ...stored, ...body }));
      }
      return Promise.resolve(response(stored));
    }
    return Promise.reject(new Error(`unexpected fetch ${String(url)}`));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function renderAdvisorSection() {
  const Switcher = () => {
    const { setSection } = useSettingsView();
    useEffect(() => {
      setSection("advisor");
    }, [setSection]);
    return <SettingsPage />;
  };
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SettingsViewProvider active>
          <Switcher />
        </SettingsViewProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function openDetails() {
  fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
  expect(await screen.findByLabelText("Model endpoint")).toBeTruthy();
}

function statusCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v1/advisor/status"))
    .length;
}

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

describe("AdvisorSection", () => {
  it("prefills stored values over the shipped defaults", async () => {
    stubFetch();
    renderAdvisorSection();
    await openDetails();
    // Hydration replaces every default in one update; waiting on the endpoint
    // proves the stored values arrived before asserting the rest.
    expect(await screen.findByDisplayValue("http://127.0.0.1:11434/v1")).toBeTruthy();
    expect((screen.getByLabelText("Request budget") as HTMLInputElement).value).toBe("25");
    expect(
      screen.getByRole("switch", { name: "Raw response visibility" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen.getByRole("switch", { name: "Public endpoint opt-in" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect((screen.getByLabelText("Model id") as HTMLInputElement).value).toBe("qwen3:8b");
    expect((screen.getByLabelText("API key variable") as HTMLInputElement).value).toBe(
      "BLACKGLASS_ADVISOR_API_KEY",
    );
  });

  it("shows shipped contract defaults when nothing is configured", async () => {
    fetchMock = vi.fn((url: string) => {
      if (String(url).includes("/api/v1/advisor/status")) {
        return Promise.resolve(
          response({
            configured: false,
            endpointReachable: null,
            modelId: "",
            endpointHost: "",
            publicEndpoint: false,
            optIn: false,
            keyEnvVar: "",
            keyPresent: false,
            latencyMs: null,
            reason: "unconfigured",
          }),
        );
      }
      return Promise.resolve(response({ ...ADVISOR_SETTINGS_DEFAULTS }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAdvisorSection();
    expect((await screen.findByLabelText("Request budget")) as HTMLInputElement).toHaveProperty(
      "value",
      "10",
    );
    expect(
      screen.getByRole("switch", { name: "Raw response visibility" }).getAttribute("aria-checked"),
    ).toBe("true");
    await openDetails();
    expect((screen.getByLabelText("Model endpoint") as HTMLInputElement).value).toBe("");
  });

  it("saves edited values, confirms, and re-reads connection status", async () => {
    stubFetch();
    renderAdvisorSection();
    // Wait for stored values so the edit cannot race hydration.
    expect(await screen.findByDisplayValue("25")).toBeTruthy();
    const budget = screen.getByLabelText("Request budget") as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advisor settings" }));
    expect(await screen.findByText("Advisor settings saved.")).toBeTruthy();
    const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit)?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(String((put?.[1] as RequestInit)?.body))).toMatchObject({
      endpointBaseUrl: "http://127.0.0.1:11434/v1",
      modelId: "qwen3:8b",
      apiKeyEnvVar: "BLACKGLASS_ADVISOR_API_KEY",
      requestBudget: 30,
    });
    // A successful save invalidates the tested connection.
    await waitFor(() => expect(statusCalls()).toBeGreaterThanOrEqual(2));
  });

  it("shows a validation message without sending an update", async () => {
    stubFetch();
    renderAdvisorSection();
    expect(await screen.findByDisplayValue("25")).toBeTruthy();
    const budget = screen.getByLabelText("Request budget") as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advisor settings" }));
    expect(await screen.findByText("Request budget must be an integer in 1-100.")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === "PUT")).toBe(
      false,
    );
  });

  it("rejects key material in reference fields without sending", async () => {
    stubFetch();
    renderAdvisorSection();
    await openDetails();
    expect(await screen.findByDisplayValue("http://127.0.0.1:11434/v1")).toBeTruthy();
    const model = screen.getByLabelText("Model id") as HTMLInputElement;
    fireEvent.change(model, { target: { value: "sk-abc123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advisor settings" }));
    expect(
      await screen.findByText("Key names must not contain key material. Enter the variable name only."),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === "PUT")).toBe(
      false,
    );
  });

  it("keeps edited values when the server rejects the save", async () => {
    stubFetch(() => response({ code: "invalid_request" }, 400));
    renderAdvisorSection();
    expect(await screen.findByDisplayValue("25")).toBeTruthy();
    const budget = screen.getByLabelText("Request budget") as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save advisor settings" }));
    expect(
      await screen.findByText("The advisor settings update failed. Values kept. Check the values and try again."),
    ).toBeTruthy();
    expect((screen.getByLabelText("Request budget") as HTMLInputElement).value).toBe("30");
  });

  it("tests the connection explicitly and reports the endpoint reachable, never the model verified", async () => {
    stubFetch();
    renderAdvisorSection();
    // No status copy before the operator asks: the test is explicit.
    expect(screen.queryByText(/Endpoint reachable/)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    const detail = await screen.findByText(/Endpoint reachable at 127\.0\.0\.1 in 12 ms/);
    expect(detail.textContent).toContain("Headers-only probe");
    expect(detail.textContent).toContain("model output not verified");
    expect(detail.textContent).not.toContain("http://");
  });

  it("opens the Advisor section for /settings?section=advisor and keeps the Appearance default otherwise", async () => {
    const routerFetch = (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/v1/system/status")) {
        return Promise.resolve(response({ version: 1, overall: "ready", developmentStorage: "ready" }));
      }
      if (String(url).includes("/api/v1/engagements")) return Promise.resolve(response([]));
      if (String(url).includes("/api/v1/advisor/status")) return Promise.resolve(response(okStatus));
      if (String(url).includes("/api/v1/settings/advisor")) {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Promise.resolve(response({ ...stored, ...body }));
        }
        return Promise.resolve(response(stored));
      }
      return Promise.reject(new Error(`unexpected fetch ${String(url)}`));
    };
    vi.stubGlobal("fetch", vi.fn(routerFetch));
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ["/settings?section=advisor"] }),
    );
    await router.load();
    const first = render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Advisor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save advisor settings" })).toBeTruthy();
    first.unmount();
    router.history.destroy();

    const plain = createAppRouter(createMemoryHistory({ initialEntries: ["/settings"] }));
    await plain.load();
    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={plain} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Appearance" })).toBeTruthy();
    plain.history.destroy();
  });
});
