// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "../query-client.js";
import { actionLifecycleStatusCopy, isTerminalActionState, persistedActionQueryKey, persistedActionQueryOptions } from "./action-query.js";
describe("action-query", () => {
  it("maps terminal states and lifecycle copy truthfully", () => {
    expect(isTerminalActionState("succeeded")).toBe(true);
    expect(isTerminalActionState("failed")).toBe(true);
    expect(isTerminalActionState("cancelled")).toBe(true);
    expect(isTerminalActionState("capability_error")).toBe(true);
    expect(isTerminalActionState("queued")).toBe(false);
    expect(isTerminalActionState("active")).toBe(false);
    expect(actionLifecycleStatusCopy({ state: "queued", runState: null })).toBe("Action queued");
    expect(actionLifecycleStatusCopy({ state: "active", runState: "running" })).toBe("Action running");
    expect(actionLifecycleStatusCopy({ state: "active_paused_for_warning", runState: "running" })).toBe("Action paused for warning");
  });
  it("uses stable key and fetches without exposing bodies", async () => {
    expect(persistedActionQueryKey("eng-1", "act-1")).toEqual(["engagements", "eng-1", "actions", "act-1"]);
    const fetchMock = vi.fn(() => Promise.resolve({ json: async () => ({ code: "invalid_request" }), status: 404 } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const client = createAppQueryClient();
    await expect(client.fetchQuery(persistedActionQueryOptions("eng-1", "act-1"))).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/engagements/eng-1/actions/act-1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    client.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
