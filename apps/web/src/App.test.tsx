// @vitest-environment jsdom

import {
  CONSOLE_HEIGHT_STORAGE_KEY,
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  THEME_FAMILY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  ThemeProvider,
} from "@blackglass/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "./query-client.js";
import { createAppRouter } from "./router.js";
import { installAppearanceSync } from "./settings/appearance.js";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason?: unknown) => void;
}

interface MediaHarness {
  dispatch: (matches: boolean) => void;
  mediaQuery: MediaQueryList;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function response(payload: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  return {
    json: async () => payload,
    ok: options.ok ?? true,
    status: options.status ?? 200,
  } as Response;
}

function isSystemStatusUrl(input: RequestInfo | URL): boolean {
  return String(input).includes("/api/v1/system/status");
}

function stubWorkspaceFetch(
  statusImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (isSystemStatusUrl(input)) return Promise.resolve(statusImpl(input, init));
    if (String(input).includes("/api/v1/engagements")) return Promise.resolve(response([]));
    return Promise.reject(new Error(`unexpected fetch ${String(input)}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function statusCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input]) => isSystemStatusUrl(input as RequestInfo | URL)).length;
}

const readyStatus = { version: 1, overall: "ready", developmentStorage: "ready" };
const notReadyStatus = {
  version: 1,
  overall: "not_ready",
  developmentStorage: "not_ready",
};

function createMediaHarness(initialMatches = false): MediaHarness {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((_type: "change", listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn(
      (_type: "change", listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  return {
    mediaQuery,
    dispatch(nextMatches) {
      matches = nextMatches;
      const event = { matches } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

interface RenderAppOptions {
  strict?: boolean;
}

const testQueryClients = new Set<QueryClient>();

async function renderApp(initialEntry = "/", { strict = false }: RenderAppOptions = {}) {
  const router = createAppRouter(
    createMemoryHistory({
      initialEntries: [initialEntry],
    }),
  );
  await router.load();
  const queryClient = createAppQueryClient();
  testQueryClients.add(queryClient);
  const application = (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
  const result = render(strict ? <StrictMode>{application}</StrictMode> : application);
  return { ...result, queryClient, router };
}

// Theme controls live in the Appearance section, which is now the Settings default.
async function openAppearanceSection() {
  const heading = screen.queryByRole("heading", { level: 1, name: "Appearance" });
  if (heading) return;
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  await screen.findByRole("heading", { level: 1, name: "Appearance" });
}

let media: MediaHarness;
let appearanceCleanup: (() => void) | null = null;

beforeEach(() => {
  window.localStorage.clear();
  document.body.style.cssText = "";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280, writable: true });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900, writable: true });
  document.documentElement.className = "";
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeFamily;
  delete document.documentElement.dataset.themePreference;
  delete document.documentElement.dataset.glassOpacity;
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.reducedMotion;
  document.documentElement.style.removeProperty("--glass");
  document.documentElement.style.removeProperty("--popover");
  document.documentElement.style.removeProperty("--glass-opacity");
  media = createMediaHarness();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => media.mediaQuery),
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
  appearanceCleanup = installAppearanceSync(window);
});

afterEach(() => {
  try {
    appearanceCleanup?.();
  } catch {}
  appearanceCleanup = null;
  cleanup();
  for (const queryClient of testQueryClients) queryClient.clear();
  testQueryClients.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App system readiness", () => {
  it("aborts the discarded StrictMode request, announces loading, then reports ready", async () => {
    const request = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchMock = stubWorkspaceFetch((_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return request.promise;
    });

    await renderApp("/", { strict: true });
    const loading = screen.getByRole("status", { name: "Checking system" });
    expect(loading.getAttribute("aria-live")).toBe("polite");
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(statusCallCount(fetchMock)).toBe(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    request.resolve(response(readyStatus));
    expect(await screen.findByText("System ready")).toBeTruthy();
  });

  it("reports a valid 503 as a current not-ready state", async () => {
    stubWorkspaceFetch(() => response(notReadyStatus, { ok: false, status: 503 }));

    await renderApp();

    expect(await screen.findByText("System not ready")).toBeTruthy();
    expect(screen.getByText("Development storage is not ready.")).toBeTruthy();
    expect(screen.queryByText("System unavailable")).toBeNull();
  });

  it("distinguishes a no-response failure from not-ready", async () => {
    stubWorkspaceFetch(() => Promise.reject(new Error("offline")));

    await renderApp();

    expect(await screen.findByText("System unavailable")).toBeTruthy();
    expect(screen.queryByText("System not ready")).toBeNull();
  });

  it("reports responses that violate the shared contract", async () => {
    stubWorkspaceFetch(() => response({ ...readyStatus, path: "/private/data" }));

    await renderApp();

    expect(await screen.findByText("System unavailable")).toBeTruthy();
    expect(screen.queryByText("private")).toBeNull();
  });

  it("retries in the mounted page and accepts a later success", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = stubWorkspaceFetch(
      vi
        .fn<() => Promise<Response>>()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    );

    const { container } = await renderApp();
    const mountedPage = container.firstElementChild;
    const mountedShell = screen.getByTestId("application-shell");
    first.reject(new Error("offline"));
    expect(await screen.findByText("System unavailable")).toBeTruthy();

    fireEvent.click(within(screen.getByText("System unavailable").closest("section")!).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Checking system")).toBeTruthy();
    expect(container.firstElementChild).toBe(mountedPage);
    expect(screen.getByTestId("application-shell")).toBe(mountedShell);
    await waitFor(() => expect(statusCallCount(fetchMock)).toBe(2));

    second.resolve(response(readyStatus));
    expect(await screen.findByText("System ready")).toBeTruthy();
  });

  it("preserves cached ready status with last-known wording after a network failure", async () => {
    const second = deferred<Response>();
    const third = deferred<Response>();
    const fetchMock = stubWorkspaceFetch(
      vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(response(readyStatus))
        .mockImplementationOnce(() => second.promise)
        .mockImplementationOnce(() => third.promise),
    );

    await renderApp();
    expect(await screen.findByText("System ready")).toBeTruthy();
    const shell = screen.getByTestId("application-shell");

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(statusCallCount(fetchMock)).toBe(2));
    second.reject(new Error("GET /api?token=secret failed with body-secret"));

    const staleWarning = await screen.findByText("Last known: system ready");
    expect(screen.queryByText("System unavailable")).toBeNull();
    expect(screen.getByTestId("application-shell")).toBe(shell);

    fireEvent.click(
      within(staleWarning.closest("section")!).getByRole("button", { name: "Retry" }),
    );
    await waitFor(() => expect(statusCallCount(fetchMock)).toBe(3));
    third.resolve(response(readyStatus));
    await waitFor(() => expect(screen.queryByText("Last known: system ready")).toBeNull());
    expect(screen.getByText("System ready")).toBeTruthy();
  });

  it("preserves cached status after a malformed refresh", async () => {
    stubWorkspaceFetch(
      vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(response(readyStatus))
        .mockResolvedValueOnce(response({ ...readyStatus, rawError: "/private/path" })),
    );

    await renderApp();
    expect(await screen.findByText("System ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByText("Last known: system ready")).toBeTruthy();
    expect(screen.queryByText("private")).toBeNull();
  });

  it("replaces cached ready data with a valid not-ready 503", async () => {
    stubWorkspaceFetch(
      vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(response(readyStatus))
        .mockResolvedValueOnce(response(notReadyStatus, { ok: false, status: 503 })),
    );

    await renderApp();
    expect(await screen.findByText("System ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByText("System not ready")).toBeTruthy();
    expect(screen.queryByText("Last known: system ready")).toBeNull();
  });
});

describe("Application shell", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
  });

  it("restores, toggles, and persists desktop sidebar state", async () => {
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false");
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "430");
    await renderApp();

    const shell = screen.getByTestId("application-shell");
    const toggle = screen.getByRole("button", { name: "Show sidebar" });
    expect(shell.dataset.sidebarOpen).toBe("false");
    expect(shell.getAttribute("style")).toContain("--shell-sidebar-width: 430px");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(shell.dataset.sidebarOpen).toBe("true");
    expect(window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true");
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
  });

  it("handles Mod+B in capture phase and ignores keybinding capture regions", async () => {
    await renderApp();
    const shell = screen.getByTestId("application-shell");
    const toggle = screen.getByRole("button", { name: "Hide sidebar" });
    expect(toggle.getAttribute("aria-keyshortcuts")).toBe("Control+B Meta+B");

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(shell.dataset.sidebarOpen).toBe("false");

    const captureRegion = document.createElement("div");
    captureRegion.dataset.keybindingCapture = "";
    const input = document.createElement("input");
    captureRegion.append(input);
    document.body.append(captureRegion);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(shell.dataset.sidebarOpen).toBe("false");
    captureRegion.remove();

    fireEvent.keyDown(window, { key: "B", metaKey: true });
    expect(shell.dataset.sidebarOpen).toBe("true");
  });

  it("keeps mobile navigation independent and restores focus after navigation", async () => {
    window.innerWidth = 500;
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false");
    await renderApp();

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Blackglass navigation" })).toBeTruthy();
    expect(screen.getByTestId("application-shell").dataset.sidebarOpen).toBe("false");

    fireEvent.click(screen.getAllByRole("link", { name: "Engagements" })[0]!);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Blackglass navigation" })).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByTestId("application-shell").dataset.sidebarOpen).toBe("false");
  });

  it("does not overwrite desktop geometry while mounted on mobile", async () => {
    window.innerWidth = 500;
    window.innerHeight = 600;
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "430");
    window.localStorage.setItem(CONSOLE_HEIGHT_STORAGE_KEY, "410");
    await renderApp();

    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("430");
    expect(window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY)).toBe("410");

    window.innerWidth = 1280;
    window.innerHeight = 900;
    fireEvent(window, new Event("resize"));
    const style = screen.getByTestId("application-shell").getAttribute("style");
    expect(style).toContain("--shell-sidebar-width: 430px");
    expect(style).toContain("--shell-console-height: 410px");
  });

  it("closes mobile navigation with Escape", async () => {
    window.innerWidth = 500;
    await renderApp();
    const trigger = screen.getByRole("button", { name: "Open navigation" });

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Blackglass navigation" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes both mobile sheets on desktop takeover and moves focus to desktop controls", async () => {
    window.innerWidth = 390;
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await screen.findByRole("dialog", { name: "Blackglass navigation" });
    window.innerWidth = 700;
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("dialog", { name: "Blackglass navigation" })).toBeTruthy();
    window.innerWidth = 1000;
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Blackglass navigation" })).toBeNull(),
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Hide sidebar" }));

    window.innerWidth = 390;
    fireEvent(window, new Event("resize"));
    fireEvent.click(screen.getByRole("button", { name: "Open console" }));
    await screen.findByRole("dialog", { name: "Console" });
    window.innerWidth = 767;
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("dialog", { name: "Console" })).toBeTruthy();
    window.innerWidth = 1000;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Console" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Console" }));
  });

  it("provides keyboard tabs and independent mobile console state", async () => {
    window.innerWidth = 500;
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false");
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Open console" }));
    expect(await screen.findByRole("dialog", { name: "Console" })).toBeTruthy();
    const advisor = screen.getByRole("tab", { name: "Advisor" });
    advisor.focus();
    fireEvent.keyDown(advisor, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(screen.getByRole("tabpanel", { name: "Activity" })).toBeTruthy();
    expect(screen.getByTestId("application-shell").dataset.sidebarOpen).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Close console" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Console" })).toBeNull());
  });

  it("collapses and reopens the desktop console without changing its height", async () => {
    window.localStorage.setItem(CONSOLE_HEIGHT_STORAGE_KEY, "410");
    await renderApp();
    const consoleRegion = screen.getByRole("region", { name: "Console" });
    expect(screen.getByRole("separator", { name: "Resize console" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse console" }));
    expect(consoleRegion.className).toContain("shell-console-collapsed");
    expect(screen.queryByRole("separator", { name: "Resize console" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand console" }));
    expect(consoleRegion.className).not.toContain("shell-console-collapsed");
    expect(window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY)).toBe("410");
  });

  it("resizes the sidebar with keyboard controls and ignores unrelated keys", async () => {
    await renderApp();
    const rail = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(rail.getAttribute("tabindex")).toBe("0");
    expect(rail.className).toContain("focus-visible:ring-2");

    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail.getAttribute("aria-valuenow")).toBe("272");
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("272");
    fireEvent.keyDown(rail, { key: "ArrowLeft" });
    expect(rail.getAttribute("aria-valuenow")).toBe("256");
    fireEvent.keyDown(rail, { key: "Home" });
    expect(rail.getAttribute("aria-valuenow")).toBe("208");
    fireEvent.keyDown(rail, { key: "End" });
    expect(rail.getAttribute("aria-valuenow")).toBe("640");

    const handled = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    expect(rail.dispatchEvent(handled)).toBe(false);
    expect(handled.defaultPrevented).toBe(true);

    const unrelated = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "PageUp",
    });
    expect(rail.dispatchEvent(unrelated)).toBe(true);
    expect(unrelated.defaultPrevented).toBe(false);
  });

  it("resizes the console with keyboard controls", async () => {
    await renderApp();
    const rail = screen.getByRole("separator", { name: "Resize console" });
    expect(rail.getAttribute("tabindex")).toBe("0");
    expect(rail.className).toContain("focus-visible:ring-2");

    fireEvent.keyDown(rail, { key: "ArrowUp" });
    expect(rail.getAttribute("aria-valuenow")).toBe("336");
    expect(window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY)).toBe("336");
    fireEvent.keyDown(rail, { key: "ArrowDown" });
    expect(rail.getAttribute("aria-valuenow")).toBe("320");
    fireEvent.keyDown(rail, { key: "Home" });
    expect(rail.getAttribute("aria-valuenow")).toBe("220");
    fireEvent.keyDown(rail, { key: "End" });
    expect(rail.getAttribute("aria-valuenow")).toBe("540");
  });

  it("batches sidebar resize into one frame, clamps, and restores document styles", async () => {
    const frames: FrameRequestCallback[] = [];
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    });
    await renderApp();
    frames.length = 0;
    const rail = screen.getByRole("separator", { name: "Resize sidebar" });
    Object.assign(rail, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";

    fireEvent.pointerDown(rail, { button: 0, clientX: 256, isPrimary: true, pointerId: 7 });
    fireEvent.pointerMove(rail, { clientX: 400, pointerId: 7 });
    fireEvent.pointerMove(rail, { clientX: 2000, pointerId: 7 });
    expect(frames).toHaveLength(1);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("256");

    act(() => frames.shift()?.(0));
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("640");
    fireEvent.pointerUp(rail, { pointerId: 7 });
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(false);
  });

  it("ignores non-primary resize and cleans up cancel and unmount", async () => {
    const { unmount } = await renderApp();
    const rail = screen.getByRole("separator", { name: "Resize sidebar" });
    const releasePointerCapture = vi.fn();
    Object.assign(rail, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
      setPointerCapture: vi.fn(),
    });

    fireEvent.pointerDown(rail, { button: 2, clientX: 256, isPrimary: true, pointerId: 1 });
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(false);
    fireEvent.pointerDown(rail, { button: 0, clientX: 256, isPrimary: false, pointerId: 2 });
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(false);

    fireEvent.pointerDown(rail, { button: 0, clientX: 256, isPrimary: true, pointerId: 3 });
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(true);
    fireEvent.pointerCancel(rail, { pointerId: 3 });
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(false);

    fireEvent.pointerDown(rail, { button: 0, clientX: 256, isPrimary: true, pointerId: 4 });
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    unmount();
    expect(releasePointerCapture).toHaveBeenCalledWith(4);
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("suppresses the click after a drag longer than two pixels", async () => {
    await renderApp();
    const rail = screen.getByRole("separator", { name: "Resize sidebar" });
    Object.assign(rail, {
      hasPointerCapture: vi.fn(() => false),
      setPointerCapture: vi.fn(),
    });
    fireEvent.pointerDown(rail, { button: 0, clientX: 256, isPrimary: true, pointerId: 5 });
    fireEvent.pointerMove(rail, { clientX: 260, pointerId: 5 });
    fireEvent.pointerUp(rail, { pointerId: 5 });
    const suppressed = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(rail.dispatchEvent(suppressed)).toBe(false);
    expect(suppressed.defaultPrevented).toBe(true);
    const nextClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(rail.dispatchEvent(nextClick)).toBe(true);
    expect(nextClick.defaultPrevented).toBe(false);
  });

  it("aborts an active sidebar resize when the sidebar closes", async () => {
    await renderApp();
    const rail = screen.getByRole("separator", { name: "Resize sidebar" });
    const releasePointerCapture = vi.fn();
    Object.assign(rail, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
      setPointerCapture: vi.fn(),
    });
    document.body.style.cursor = "wait";
    document.body.style.userSelect = "text";

    fireEvent.pointerDown(rail, { button: 0, clientX: 256, isPrimary: true, pointerId: 10 });
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });

    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
    expect(releasePointerCapture).toHaveBeenCalledWith(10);
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(false);
    expect(document.body.style.cursor).toBe("wait");
    expect(document.body.style.userSelect).toBe("text");
  });

  it("cancels pending console resize work when the console collapses", async () => {
    await renderApp();
    let queuedFrame: FrameRequestCallback | null = null;
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        queuedFrame = callback;
        return 44;
      }),
    });
    const cancelFrame = vi.fn();
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: cancelFrame,
    });
    const rail = screen.getByRole("separator", { name: "Resize console" });
    const releasePointerCapture = vi.fn();
    Object.assign(rail, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
      setPointerCapture: vi.fn(),
    });

    fireEvent.pointerDown(rail, { button: 0, clientY: 580, isPrimary: true, pointerId: 11 });
    fireEvent.pointerMove(rail, { clientY: 400, pointerId: 11 });
    fireEvent.click(screen.getByRole("button", { name: "Collapse console" }));

    expect(cancelFrame).toHaveBeenCalledWith(44);
    expect(releasePointerCapture).toHaveBeenCalledWith(11);
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    act(() => queuedFrame?.(0));
    expect(window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY)).toBe("320");
  });

  it("aborts an active resize when the viewport crosses to mobile", async () => {
    window.innerWidth = 848;
    window.innerHeight = 400;
    await renderApp();
    const rail = screen.getByRole("separator", { name: "Resize sidebar" });
    const releasePointerCapture = vi.fn();
    Object.assign(rail, {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
      setPointerCapture: vi.fn(),
    });
    document.documentElement.classList.add("shell-resizing");
    document.body.style.cursor = "help";
    document.body.style.userSelect = "all";

    fireEvent.pointerDown(rail, { button: 0, clientX: 208, isPrimary: true, pointerId: 12 });
    window.innerWidth = 700;
    window.innerHeight = 300;
    fireEvent(window, new Event("resize"));

    expect(releasePointerCapture).toHaveBeenCalledWith(12);
    expect(document.documentElement.classList.contains("shell-resizing")).toBe(true);
    expect(document.body.style.cursor).toBe("help");
    expect(document.body.style.userSelect).toBe("all");
  });

  it("persists console resize and re-clamps both dimensions on viewport resize", async () => {
    await renderApp();
    const consoleRail = screen.getByRole("separator", { name: "Resize console" });
    Object.assign(consoleRail, {
      hasPointerCapture: vi.fn(() => false),
      setPointerCapture: vi.fn(),
    });
    fireEvent.pointerDown(consoleRail, {
      button: 0,
      clientY: 580,
      isPrimary: true,
      pointerId: 8,
    });
    fireEvent.pointerMove(consoleRail, { clientY: 400, pointerId: 8 });
    fireEvent.pointerUp(consoleRail, { pointerId: 8 });
    expect(window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY)).toBe("500");

    window.innerWidth = 700;
    window.innerHeight = 300;
    fireEvent(window, new Event("resize"));
    const style = screen.getByTestId("application-shell").getAttribute("style");
    expect(style).toContain("--shell-sidebar-width: 208px");
    expect(style).toContain("--shell-console-height: 220px");
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("256");
    expect(window.localStorage.getItem(CONSOLE_HEIGHT_STORAGE_KEY)).toBe("500");
  });

  it("exposes reduced-motion shell rules and labelled resize controls", async () => {
    await renderApp();
    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize console" })).toBeTruthy();
    expect(document.querySelector(".application-shell")).toBeTruthy();
  });
});

describe("App theme preference", () => {
  it("uses the stored preference and exposes orb pressed state", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    await renderApp("/settings");
    await openAppearanceSection();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Smoked lime dark" }).getAttribute("data-on")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Smoked lime dark" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: null }));
    });
    // system with prefers-light => light
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Smoked lime light" }).getAttribute("data-on")).toBe(
      "true",
    );
  });

  it("falls back to system for invalid or unreadable storage", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const first = await renderApp("/settings");
    await openAppearanceSection();
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    first.unmount();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await renderApp("/settings");
    await openAppearanceSection();
    expect(document.documentElement.dataset.themePreference).toBe("system");
  });

  it("reacts to OS changes only while system is selected and cleans up the listener", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { unmount } = await renderApp("/settings");
    await openAppearanceSection();

    act(() => media.dispatch(true));
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Smoked lime light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => media.dispatch(false));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(media.mediaQuery.removeEventListener).toHaveBeenCalled();

    unmount();
  });

  it("synchronizes valid storage events and ignores malformed values", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }),
      );
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Smoked lime dark" }).getAttribute("data-on")).toBe("true");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "midnight" }),
      );
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps theme selection usable when storage writes fail", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    await renderApp("/settings");
    await openAppearanceSection();

    fireEvent.click(screen.getByRole("button", { name: "Smoked lime dark" }));
    expect(screen.getByRole("button", { name: "Smoked lime dark" }).getAttribute("data-on")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("exposes pressed state for the orb scheme selection", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    for (const { name, scheme } of [
      { name: "Smoked lime light", scheme: "light" },
      { name: "Smoked lime dark", scheme: "dark" },
    ] as const) {
      const orb = screen.getByRole("button", { name }) as HTMLButtonElement;
      fireEvent.click(orb);
      expect(orb.getAttribute("aria-pressed")).toBe("true");
      expect(orb.getAttribute("data-on")).toBe("true");
      expect(document.documentElement.dataset.theme).toBe(scheme);
      // Focus remains on the clicked orb
      orb.focus();
      expect(document.activeElement).toBe(orb);
    }
  });

  it("persists theme family separately from scheme and applies both to the document", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    expect(document.documentElement.dataset.themeFamily).toBe("smoked");
    fireEvent.click(screen.getByRole("button", { name: "Void dark" }));
    expect(document.documentElement.dataset.themeFamily).toBe("void");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(window.localStorage.getItem(THEME_FAMILY_STORAGE_KEY)).toBe("void");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Void dark" }).getAttribute("data-on")).toBe("true");
    expect(screen.getByRole("button", { name: "Smoked lime dark" }).getAttribute("data-on")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Ember light" }));
    expect(document.documentElement.dataset.themeFamily).toBe("ember");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_FAMILY_STORAGE_KEY)).toBe("ember");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.getByRole("button", { name: "Ember light" }).getAttribute("data-on")).toBe("true");
  });

  it("keeps family when the orb scheme changes", async () => {
    window.localStorage.setItem(THEME_FAMILY_STORAGE_KEY, "iris");
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    expect(document.documentElement.dataset.themeFamily).toBe("iris");
    fireEvent.click(screen.getByRole("button", { name: "Iris light" }));
    expect(document.documentElement.dataset.themeFamily).toBe("iris");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_FAMILY_STORAGE_KEY)).toBe("iris");

    // Switching family preserves the light scheme
    fireEvent.click(screen.getByRole("button", { name: "Void light" }));
    expect(document.documentElement.dataset.themeFamily).toBe("void");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to smoked for invalid or unreadable family storage", async () => {
    window.localStorage.setItem(THEME_FAMILY_STORAGE_KEY, "mint");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const first = await renderApp("/settings");
    expect(document.documentElement.dataset.themeFamily).toBe("smoked");
    first.unmount();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await renderApp("/settings");
    expect(document.documentElement.dataset.themeFamily).toBe("smoked");
  });

  it("synchronizes valid family storage events and ignores malformed values", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_FAMILY_STORAGE_KEY, newValue: "grove" }),
      );
    });
    expect(document.documentElement.dataset.themeFamily).toBe("grove");
    expect(
      screen.getByRole("button", { name: "Grove light" }).closest("[data-theme-family]")?.getAttribute(
        "data-selected",
      ),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Grove light" }).getAttribute("data-on")).toBe("true");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_FAMILY_STORAGE_KEY, newValue: "mint" }),
      );
    });
    expect(document.documentElement.dataset.themeFamily).toBe("grove");
  });

  it("keeps orb keyboard focus and pressed semantics without intercepting native navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    const dark = screen.getByRole("button", { name: "Smoked lime dark" }) as HTMLButtonElement;
    const light = screen.getByRole("button", { name: "Smoked lime light" }) as HTMLButtonElement;
    dark.focus();
    expect(document.activeElement).toBe(dark);
    expect(dark.getAttribute("aria-pressed")).toBeDefined();

    const arrowRight = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    expect(dark.dispatchEvent(arrowRight)).toBe(true);
    expect(arrowRight.defaultPrevented).toBe(false);

    light.click();
    expect(light.getAttribute("data-on")).toBe("true");
    expect(light.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");

    light.focus();
    const tab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    expect(light.dispatchEvent(tab)).toBe(true);
    expect(tab.defaultPrevented).toBe(false);
    const nextTabStop = screen.getByTestId("settings-back");
    nextTabStop.focus();
    expect(document.activeElement).toBe(nextTabStop);
  });

  it("updates the whole app theme and preserves it across navigation without remounting the shell", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();
    const shell = screen.getByTestId("application-shell");

    fireEvent.click(screen.getByRole("button", { name: "Smoked lime dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // Settings has no Dashboard link; Back returns to the last non-settings route.
    fireEvent.click(screen.getByTestId("settings-back"));
    expect(await screen.findByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
    expect(screen.getByTestId("application-shell")).toBe(shell);
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Appearance" })).toBeTruthy();
    expect(screen.getByTestId("application-shell")).toBe(shell);
    await openAppearanceSection();
    expect(screen.getByRole("button", { name: "Smoked lime dark" }).getAttribute("data-on")).toBe("true");
  });

  it("keeps empty and error actions accessible by name", async () => {
    stubWorkspaceFetch(() => Promise.reject(new Error("offline")));
    await renderApp();

    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(await screen.findAllByRole("button", { name: "Retry" })).not.toHaveLength(0);
  });
});

describe("Appearance local preferences", () => {
  it("defaults glass 26, density compact, reduced motion off and persists with strict parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    const slider = screen.getByRole("slider", { name: "Glass opacity" }) as HTMLInputElement;
    expect(slider.value).toBe("26");
    expect(screen.getByText("26%")).toBeTruthy();
    expect(document.documentElement.dataset.glassOpacity).toBe("26");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.dataset.reducedMotion).toBe("false");
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false);

    fireEvent.change(slider, { target: { value: "40" } });
    expect(window.localStorage.getItem("blackglass.glassOpacity")).toBe("40");
    expect(document.documentElement.dataset.glassOpacity).toBe("40");

    const density = screen.getByRole("combobox", { name: "Density" }) as HTMLSelectElement;
    fireEvent.change(density, { target: { value: "regular" } });
    expect(window.localStorage.getItem("blackglass.density")).toBe("regular");
    expect(document.documentElement.dataset.density).toBe("regular");

    const toggle = screen.getByRole("switch", { name: "Reduced motion" });
    fireEvent.click(toggle);
    expect(window.localStorage.getItem("blackglass.reducedMotion")).toBe("true");
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
  });

  it("ignores malformed appearance storage and falls back to defaults", async () => {
    window.localStorage.setItem("blackglass.glassOpacity", "oops");
    window.localStorage.setItem("blackglass.density", "huge");
    window.localStorage.setItem("blackglass.reducedMotion", "maybe");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    expect((screen.getByRole("slider", { name: "Glass opacity" }) as HTMLInputElement).value).toBe("26");
    expect((screen.getByRole("combobox", { name: "Density" }) as HTMLSelectElement).value).toBe(
      "compact",
    );
    expect(screen.getByRole("switch", { name: "Reduced motion" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("syncs cross-tab storage events for appearance controls", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "32" }));
    });
    expect((screen.getByRole("slider", { name: "Glass opacity" }) as HTMLInputElement).value).toBe("32");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.density", newValue: "regular" }));
    });
    expect((screen.getByRole("combobox", { name: "Density" }) as HTMLSelectElement).value).toBe("regular");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.reducedMotion", newValue: "true" }));
    });
    expect(screen.getByRole("switch", { name: "Reduced motion" }).getAttribute("aria-checked")).toBe("true");
  });

  it("rejects out-of-range glass values from storage and events and clamps UI", async () => {
    window.localStorage.setItem("blackglass.glassOpacity", "4");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/settings");
    await openAppearanceSection();
    const slider = screen.getByRole("slider", { name: "Glass opacity" }) as HTMLInputElement;
    expect(slider.value).toBe("26");
    expect(slider.min).toBe("5");
    expect(slider.max).toBe("40");
    expect(screen.getByLabelText("Glass opacity").id).toBe("glass-opacity");
    expect(document.querySelector('output[for="glass-opacity"]')?.textContent).toContain("26%");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "4" }));
    });
    expect(slider.value).toBe("26");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "41" }));
    });
    expect(slider.value).toBe("26");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "0" }));
    });
    expect(slider.value).toBe("26");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "100" }));
    });
    expect(slider.value).toBe("26");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "5" }));
    });
    expect(slider.value).toBe("5");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "40" }));
    });
    expect(slider.value).toBe("40");
  });

  it("keeps glass opacity usable when storage writes fail", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    await renderApp("/settings");
    await openAppearanceSection();
    const slider = screen.getByRole("slider", { name: "Glass opacity" }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "30" } });
    expect(slider.value).toBe("30");
    expect(document.documentElement.dataset.glassOpacity).toBe("30");
  });

  it("keeps root appearance in sync without Settings mounted and syncs back to controls", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    await renderApp("/plugins");
    expect(document.documentElement.dataset.glassOpacity).toBe("26");
    expect(document.documentElement.dataset.density).toBe("compact");

    window.localStorage.setItem("blackglass.glassOpacity", "32");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "32" }));
    });
    expect(document.documentElement.dataset.glassOpacity).toBe("32");
    window.localStorage.setItem("blackglass.density", "regular");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.density", newValue: "regular" }));
    });
    expect(document.documentElement.dataset.density).toBe("regular");

    document.documentElement.dataset.theme = "dark";
    window.localStorage.setItem("blackglass.glassOpacity", "32");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "blackglass.glassOpacity", newValue: "32" }));
    });
    const beforeGlass = document.documentElement.style.getPropertyValue("--glass");
    document.documentElement.dataset.theme = "light";
    await new Promise((r) => setTimeout(r, 0));
    const afterGlass = document.documentElement.style.getPropertyValue("--glass");
    expect(afterGlass).not.toBe(beforeGlass);
    expect(document.documentElement.dataset.glassOpacity).toBe("32");

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Appearance" })).toBeTruthy();
    expect((screen.getByRole("slider", { name: "Glass opacity" }) as HTMLInputElement).value).toBe("32");
    expect((screen.getByRole("combobox", { name: "Density" }) as HTMLSelectElement).value).toBe("regular");
  });
});

describe("Application routes", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
  });

  it.each([
    ["/", "Workspace", "Dashboard"],
    ["/engagements", "Engagements", "Engagements"],
    ["/plugins", "Plugins", null],
    ["/settings", "Appearance", null],
  ])(
    "renders a direct entry for %s inside the shell",
    async (path, heading, globalActiveLabel) => {
      await renderApp(path);

      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeTruthy();
      expect(screen.getByTestId("application-shell")).toBeTruthy();

      if (path === "/settings") {
        // Settings now defaults to Appearance per the v5 glass mock.
        const appearanceItem = screen.getByRole("button", { name: "Appearance" });
        expect(appearanceItem.getAttribute("aria-current")).toBe("true");
        expect(screen.getByRole("button", { name: "Diagnostics" })).toBeTruthy();
        expect(screen.getByTestId("settings-back")).toBeTruthy();
        return;
      }

      const globalNavigation = screen.getByRole("navigation", { name: "Global" });
      const activeGlobalLinks = within(globalNavigation)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");
      if (globalActiveLabel === null) {
        // Plugins lives in the sidebar footer, not the global navigation.
        expect(activeGlobalLinks).toHaveLength(0);
        expect(screen.getByRole("link", { name: "Plugins" }).getAttribute("aria-current")).toBe(
          "page",
        );
      } else {
        expect(activeGlobalLinks).toHaveLength(1);
        expect(activeGlobalLinks[0]?.textContent).toBe(globalActiveLabel);
      }
    },
  );

  it("navigates with exact active state while preserving the shell node", async () => {
    await renderApp();
    const shell = screen.getByTestId("application-shell");
    const globalNavigation = screen.getByRole("navigation", { name: "Global" });

    expect(
      within(globalNavigation)
        .getByRole("link", { name: "Dashboard" })
        .getAttribute("aria-current"),
    ).toBe("page");
    fireEvent.click(within(globalNavigation).getByRole("link", { name: "Engagements" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Engagements" })).toBeTruthy();
    expect(screen.getByTestId("application-shell")).toBe(shell);
    expect(
      within(globalNavigation)
        .getByRole("link", { name: "Dashboard" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      within(globalNavigation)
        .getByRole("link", { name: "Engagements" })
        .getAttribute("aria-current"),
    ).toBe("page");

    // Plugins moved into the sidebar footer next to Settings.
    fireEvent.click(screen.getByRole("link", { name: "Plugins" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Plugins" })).toBeTruthy();
    expect(screen.getByTestId("application-shell")).toBe(shell);
    expect(
      within(globalNavigation)
        .getByRole("link", { name: "Engagements" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Plugins" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders the reference appearance layout with paired orbs and no extra Scheme block", async () => {
    await renderApp("/settings");

    // Settings now opens on Appearance per the glass mock.
    expect(screen.getByRole("heading", { level: 1, name: "Appearance" })).toBeTruthy();
    expect(
      screen.getByText("Choose how Blackglass looks. Use a built-in theme or make your own."),
    ).toBeTruthy();
    expect(screen.getByText("Left bubble is dark. Right bubble is light.")).toBeTruthy();
    // No full-width Scheme block; orbs are the scheme selection.
    expect(screen.queryByRole("group", { name: "Scheme" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();

    const darkOrb = screen.getByRole("button", { name: "Smoked lime dark" });
    const lightOrb = screen.getByRole("button", { name: "Smoked lime light" });
    expect(darkOrb.getAttribute("aria-pressed")).toBeDefined();
    expect(lightOrb.getAttribute("aria-pressed")).toBeDefined();
    darkOrb.focus();
    expect(document.activeElement).toBe(darkOrb);
    expect(darkOrb.className).toContain("focus-visible:ring-2");
    expect(screen.getByRole("button", { name: "Iris light" })).toBeTruthy();
    // Theme creation has no product behavior yet, so both actions render disabled.
    const createTheme = screen.getByRole("button", { name: "Create theme" }) as HTMLButtonElement;
    const importTheme = screen.getByRole("button", { name: "Import theme" }) as HTMLButtonElement;
    expect(createTheme.disabled).toBe(true);
    expect(createTheme.getAttribute("aria-disabled")).toBe("true");
    expect(createTheme.title).toMatch(/Custom themes/);
    expect(createTheme.className).toContain("opacity-60");
    expect(importTheme.disabled).toBe(true);
    expect(importTheme.getAttribute("aria-disabled")).toBe("true");
    expect(importTheme.title).toMatch(/Custom themes/);

    // Appearance controls are now real and default to the mock values.
    expect(screen.getByRole("slider", { name: "Glass opacity" })).toBeTruthy();
    expect((screen.getByRole("slider", { name: "Glass opacity" }) as HTMLInputElement).value).toBe(
      "26",
    );
    expect(screen.getByText("26%")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Density" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Density" }) as HTMLSelectElement).value).toBe(
      "compact",
    );
    expect(screen.getByRole("switch", { name: "Reduced motion" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("renders the reference settings navigation with section switching, search, and Back", async () => {
    await renderApp("/settings");

    for (const label of [
      "General",
      "Appearance",
      "Engagements",
      "Plugins",
      "Runner",
      "Advisor",
      "Evidence",
      "Diagnostics",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Runner" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Runner" })).toBeTruthy();

    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "retention" } });
    // Scope to the search listbox; rendered sections also expose native select options.
    const results = screen.getByRole("listbox", { name: "Settings search results" });
    const hit = await within(results).findByRole("option", { selected: true });
    expect(hit.textContent).toContain("Retention");
    fireEvent.click(hit);
    expect(await screen.findByRole("heading", { level: 1, name: "Evidence" })).toBeTruthy();
    expect(document.getElementById("setting-retention")).toBeTruthy();
    expect((screen.queryByRole("combobox", { name: "Search settings" }) as HTMLInputElement).value).toBe(
      "",
    );

    fireEvent.click(screen.getByTestId("settings-back"));
    expect(await screen.findByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
  });

  it("does not render theme controls or an action spacer in desktop or mobile navigation", async () => {
    await renderApp();

    const desktopSidebar = screen.getByRole("complementary", { name: "Primary" });
    expect(within(desktopSidebar).queryByRole("radio")).toBeNull();
    expect(within(desktopSidebar).getByRole("button", { name: "New engagement" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();

    window.innerWidth = 500;
    fireEvent(window, new Event("resize"));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = await screen.findByRole("dialog", { name: "Blackglass navigation" });
    expect(within(dialog).queryByRole("radio")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "New engagement" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("closes mobile navigation after global and footer route activation", async () => {
    window.innerWidth = 500;
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    let dialog = await screen.findByRole("dialog", { name: "Blackglass navigation" });
    fireEvent.click(within(dialog).getByRole("link", { name: "Engagements" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Engagements" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    dialog = await screen.findByRole("dialog", { name: "Blackglass navigation" });
    fireEvent.click(within(dialog).getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Appearance" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("implements the plugin Installed/Available tab pattern with truthful counts", async () => {
    await renderApp("/plugins");

    const installed = screen.getByRole("tab", { name: "Installed" });
    const available = screen.getByRole("tab", { name: "Available" });
    expect(installed.getAttribute("aria-selected")).toBe("true");
    expect(installed.getAttribute("tabindex")).toBe("0");
    expect(available.getAttribute("aria-selected")).toBe("false");
    expect(available.getAttribute("tabindex")).toBe("-1");
    expect(installed.getAttribute("aria-controls")).toBe("plugins-panel");

    const panel = screen.getByRole("tabpanel", { name: "Installed" });
    expect(panel.getAttribute("aria-labelledby")).toBe("plugins-tab-installed");
    expect(screen.getByText(/bundled contract/)).toBeTruthy();

    fireEvent.keyDown(installed, { key: "ArrowRight" });
    const availableTab = screen.getByRole("tab", { name: "Available" });
    expect(availableTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(availableTab);
    expect(screen.getByRole("tabpanel", { name: "Available" })).toBeTruthy();
    expect(screen.getByText("No registry connection")).toBeTruthy();

    fireEvent.keyDown(availableTab, { key: "End" });
    expect(availableTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(availableTab);

    fireEvent.keyDown(availableTab, { key: "Home" });
    const installedAgain = screen.getByRole("tab", { name: "Installed" });
    expect(installedAgain.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(installedAgain);

    fireEvent.keyDown(installedAgain, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Available" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Available" }));
  });

  it("shows the v5 plugins header with Blackglass breadcrumb and disabled Install from path", async () => {
    await renderApp("/plugins");

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Blackglass")).toBeTruthy();
    expect(within(breadcrumb).getByText("Plugins")).toBeTruthy();
    expect(within(breadcrumb).getByRole("link", { name: "Blackglass" }).getAttribute("href")).toBe("/");

    const install = screen.getByRole("button", { name: "Install from path" });
    expect(install.hasAttribute("disabled") || install.getAttribute("aria-disabled") === "true").toBe(true);
    expect(install.title).toMatch(/D5/);
    // Plugins stage keeps truthful Nmap and no fake plugins
    expect(screen.getByText("Nmap")).toBeTruthy();
    expect(screen.queryByText("HTTP Probe")).toBeNull();
    expect(screen.getByText(/bundled contract/)).toBeTruthy();
  });

  it("closes stale Advisor details on non-endpoint hits and resets on Settings re-entry", async () => {
    await renderApp("/settings");
    const search = () => screen.getByRole("combobox", { name: "Search settings" });
    const results = () => screen.getByRole("listbox", { name: "Settings search results" });

    // The endpoint hit expands details.
    fireEvent.change(search(), { target: { value: "model endpoint" } });
    const endpointHit = await within(results()).findByRole("option", { selected: true });
    fireEvent.click(endpointHit);
    expect(await screen.findByRole("heading", { level: 1, name: "Advisor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();

    // A later non-endpoint advisor hit closes the stale disclosure.
    fireEvent.change(search(), { target: { value: "default mode" } });
    const modeHit = await within(results()).findByRole("option", { selected: true });
    fireEvent.click(modeHit);
    expect(await screen.findByRole("button", { name: "Details" })).toBeTruthy();
    expect(screen.queryByLabelText("Model endpoint")).toBeNull();

    // Re-entering Settings from elsewhere starts with the disclosure closed and resets to Appearance.
    fireEvent.click(screen.getByTestId("settings-back"));
    expect(await screen.findByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Appearance" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Advisor" }));
    expect(await screen.findByRole("button", { name: "Details" })).toBeTruthy();
  });

  it("opens Advisor details when a Model endpoint search hit is activated", async () => {
    await renderApp("/settings");

    const search = screen.getByRole("combobox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "model endpoint" } });
    const results = screen.getByRole("listbox", { name: "Settings search results" });
    const hit = await within(results).findByRole("option", { selected: true });
    expect(hit.textContent).toContain("Model endpoint");

    fireEvent.click(hit);
    expect(await screen.findByRole("heading", { level: 1, name: "Advisor" })).toBeTruthy();
    // The indexed id belongs to the visible Model endpoint row; the nested Base
    // URL keeps a distinct non-indexed id.
    const endpointRow = document.getElementById("setting-advisor-endpoint");
    expect(endpointRow?.textContent).toContain("Model endpoint");
    expect(document.getElementById("setting-advisor-endpoint-base-url")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
    expect(screen.getByLabelText("Model endpoint")).toBeTruthy();
  });

  it("focuses settings search via slash only when the input is visible", async () => {
    await renderApp("/settings");
    const search = screen.getByRole("combobox", { name: "Search settings" }) as HTMLInputElement;
    const rects = vi.spyOn(search, "getClientRects");

    rects.mockReturnValue([] as unknown as DOMRectList);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).not.toBe(search);

    rects.mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(search);
  });

  it("matches reference chrome visibility: Settings drops header and console, Plugins drops console only", async () => {
    const dashboard = await renderApp("/");
    expect(screen.getByRole("region", { name: "Console" })).toBeTruthy();
    expect(document.querySelector(".shell-stage-header")).toBeTruthy();
    dashboard.unmount();

    const settings = await renderApp("/settings");
    expect(screen.queryByRole("region", { name: "Console" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open console" })).toBeNull();
    expect(document.querySelector(".shell-stage-header")).toBeNull();
    // Mobile navigation stays usable without the desktop stage header.
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog", { name: "Blackglass navigation" })).toBeTruthy();
    settings.unmount();

    const plugins = await renderApp("/plugins");
    expect(screen.queryByRole("region", { name: "Console" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open console" })).toBeNull();
    expect(document.querySelector(".shell-stage-header")).toBeTruthy();
    plugins.unmount();
  });

  it("keeps unknown paths inside the shell with a useful recovery link", async () => {
    await renderApp("/missing/workspace");

    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByText("/missing/workspace")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Return to Dashboard" }).getAttribute("href")).toBe(
      "/",
    );
    expect(screen.getByTestId("application-shell")).toBeTruthy();
    expect(
      within(screen.getByRole("navigation", { name: "Global" }))
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page"),
    ).toHaveLength(0);
  });

  it("keeps unknown engagement paths inside the shell", async () => {
    stubWorkspaceFetch(() => new Promise<Response>(() => undefined));
    await renderApp("/engagements/10000000-0000-4000-8000-000000000099");

    expect(await screen.findByRole("heading", { level: 1, name: "Engagements" })).toBeTruthy();
    expect(screen.getByTestId("application-shell")).toBeTruthy();
  });

  it("opens the most recently updated active engagement from the dashboard", async () => {
    const older = {
      contractVersion: 1,
      id: "10000000-0000-4000-8000-000000000001",
      revision: 1,
      name: "Older lab",
      kind: "lab",
      status: "active",
      description: null,
      authorizationContext: null,
      autoContinueWarnings: false,
      activeScopeRevisionId: null,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    };
    const newer = {
      ...older,
      id: "10000000-0000-4000-8000-000000000002",
      name: "Newer lab",
      createdAt: "2026-08-12T13:00:00.000Z",
      updatedAt: "2026-08-12T13:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (isSystemStatusUrl(input)) return Promise.resolve(response(readyStatus));
        if (String(input).includes("/api/v1/engagements")) {
          return Promise.resolve(response([older, newer]));
        }
        return Promise.reject(new Error(`unexpected fetch ${String(input)}`));
      }),
    );

    await renderApp("/");
    const current = (await screen.findByRole("heading", { name: "Current engagement" })).closest(
      "section",
    );
    expect(current).toBeTruthy();
    expect(within(current!).getByRole("link", { name: "Newer lab" })).toBeTruthy();
    expect(within(current!).queryByRole("link", { name: "Older lab" })).toBeNull();
  });
});
