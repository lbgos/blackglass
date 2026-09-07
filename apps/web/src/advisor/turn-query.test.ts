import { afterEach, describe, expect, it, vi } from "vitest";

import {
  advisorTurnsQueryKey,
  fetchAdvisorTurnsPage,
  requestAdvisorTurn,
} from "./turn-query.js";

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

const ENGAGEMENT_ID = "10000000-0000-4000-8000-000000000001";

const pendingTurn = {
  id: "10000000-0000-4000-8000-000000000001",
  engagementId: "10000000-0000-4000-8000-000000000002",
  question: "What does this show?",
  modelId: "test-model",
  redactions: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  status: "pending",
  answer: "",
  uncertainty: "",
  citations: [],
  abstained: null,
  errorCode: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("advisor turn history client", () => {
  it("uses a stable key and forwards cursor bounds verbatim", async () => {
    expect(advisorTurnsQueryKey(ENGAGEMENT_ID)).toEqual([
      "engagements",
      ENGAGEMENT_ID,
      "advisor",
      "turns",
    ]);
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(
        response({ turns: [], nextCursor: null }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchAdvisorTurnsPage(
      ENGAGEMENT_ID,
      {
        limit: 10,
        before: { createdAt: "2026-01-02T00:00:00.000Z", id: "turn-9" },
      },
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(typeof url).toBe("string");
    const parsed = new URL(String(url), "http://localhost");
    expect(parsed.pathname).toBe(`/api/v1/engagements/${ENGAGEMENT_ID}/advisor/turns`);
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("beforeCreatedAt")).toBe("2026-01-02T00:00:00.000Z");
    expect(parsed.searchParams.get("beforeId")).toBe("turn-9");
  });

  it("rejects malformed history payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response({ turns: [{}] }))));
    await expect(fetchAdvisorTurnsPage(ENGAGEMENT_ID)).rejects.toThrow(
      "The advisor history request failed.",
    );
  });
});

describe("advisor turn request client", () => {
  const input = {
    question: "What does this show?",
    excerptArtifactIds: ["artifact-1"],
    findingIds: [],
  };

  it("sends the idempotency key and parses the turn", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        "Idempotency-Key": "test-key-000000000000000001",
      });
      return Promise.resolve(response(pendingTurn));
    });
    vi.stubGlobal("fetch", fetchMock);
    const turn = await requestAdvisorTurn(ENGAGEMENT_ID, input, "test-key-000000000000000001");
    expect(turn).toMatchObject({ id: pendingTurn.id, status: "pending" });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      question: input.question,
    });
  });

  it("surfaces typed error codes without leaking payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response({ code: "turn_in_progress" }, 409))),
    );
    const error = await requestAdvisorTurn(ENGAGEMENT_ID, input, "test-key-000000000000000002").catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: unknown }).code).toBe("turn_in_progress");
  });

  it("treats network failure as an ambiguous error without a code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("network down"))),
    );
    const error = await requestAdvisorTurn(ENGAGEMENT_ID, input, "test-key-000000000000000003").catch(
      (failure: unknown) => failure,
    );
    expect((error as { code?: unknown }).code).toBe("request_failed");
  });
});
