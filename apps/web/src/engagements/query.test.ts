import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppQueryClient } from "../query-client.js";
import {
  ENGAGEMENT_DETAIL_QUERY_ERROR_MESSAGE,
  ENGAGEMENTS_QUERY_ERROR_MESSAGE,
  EngagementDetailQueryError,
  EngagementsQueryError,
} from "./errors.js";
import {
  ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE,
  ENGAGEMENTS_QUERY_KEY,
  engagementDetailQueryKey,
  engagementDetailQueryOptions,
  engagementServicesQueryKey,
  engagementServicesQueryOptions,
  engagementsQueryOptions,
  EngagementServicesQueryError,
  partitionEngagements,
} from "./query.js";

const engagement = {
  contractVersion: 1 as const,
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  name: "Target lab",
  kind: "lab" as const,
  status: "active" as const,
  description: null,
  authorizationContext: null,
  autoContinueWarnings: false,
  activeScopeRevisionId: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
};

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

async function captureQueryError(): Promise<Error> {
  const client = createAppQueryClient();
  try {
    await client.fetchQuery(engagementsQueryOptions);
    throw new Error("Expected the engagement query to fail.");
  } catch (error) {
    return error as Error;
  } finally {
    client.clear();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("engagementsQueryOptions", () => {
  it("uses a stable key, an abort signal, and the shared list contract", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(response([engagement]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createAppQueryClient();

    await expect(client.fetchQuery(engagementsQueryOptions)).resolves.toEqual([engagement]);
    expect(engagementsQueryOptions.queryKey).toBe(ENGAGEMENTS_QUERY_KEY);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/engagements",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    client.clear();
  });

  it("rejects extra fields and malformed list payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response([{ ...engagement, secret: "/private/path" }]))),
    );

    const error = await captureQueryError();

    expect(error).toBeInstanceOf(EngagementsQueryError);
    expect(error.message).toBe(ENGAGEMENTS_QUERY_ERROR_MESSAGE);
    expect(error.message).not.toContain("secret");
    expect(error.message).not.toContain("private");
  });

  it("does not read or expose bodies for unsupported HTTP statuses", async () => {
    const readBody = vi.fn(() => Promise.resolve({ token: "body-secret" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ json: readBody, ok: false, status: 500 } as unknown as Response)),
    );

    const error = await captureQueryError();

    expect(readBody).not.toHaveBeenCalled();
    expect(error.message).toBe(ENGAGEMENTS_QUERY_ERROR_MESSAGE);
    expect(error.message).not.toContain("body-secret");
  });

  it("replaces network details with one safe error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("GET /api?token=secret failed at /private/path"))),
    );

    const error = await captureQueryError();

    expect(error).toBeInstanceOf(EngagementsQueryError);
    expect(error.message).toBe(ENGAGEMENTS_QUERY_ERROR_MESSAGE);
    expect(error.message).not.toContain("secret");
    expect(error.cause).toBeUndefined();
  });
});

describe("engagementDetailQueryOptions", () => {
  it("fetches and validates the detail contract with the active scope", async () => {
    const detail = { engagement, activeScopeRevision: null };
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(response(detail));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createAppQueryClient();

    await expect(client.fetchQuery(engagementDetailQueryOptions(engagement.id))).resolves.toEqual(
      detail,
    );
    expect(engagementDetailQueryOptions(engagement.id).queryKey).toEqual(
      engagementDetailQueryKey(engagement.id),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/engagements/${engagement.id}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    client.clear();
  });

  it("rejects extra fields and hides network details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          response({
            engagement: { ...engagement, secret: "/private/path" },
            activeScopeRevision: null,
          }),
        ),
      ),
    );
    const client = createAppQueryClient();
    await expect(client.fetchQuery(engagementDetailQueryOptions(engagement.id))).rejects.toMatchObject({
      name: "EngagementDetailQueryError",
      message: ENGAGEMENT_DETAIL_QUERY_ERROR_MESSAGE,
    });
    expect(ENGAGEMENT_DETAIL_QUERY_ERROR_MESSAGE).not.toContain("secret");
    client.clear();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("GET /api?token=secret failed at /private/path"))),
    );
    const retryClient = createAppQueryClient();
    try {
      await retryClient.fetchQuery(engagementDetailQueryOptions(engagement.id));
      throw new Error("Expected the engagement detail query to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EngagementDetailQueryError);
      expect((error as Error).message).toBe(ENGAGEMENT_DETAIL_QUERY_ERROR_MESSAGE);
      expect((error as Error).message).not.toContain("secret");
    } finally {
      retryClient.clear();
    }
  });
});

describe("engagementServicesQueryOptions", () => {
  const service = {
    address: "192.0.2.10",
    port: 22,
    protocol: "tcp" as const,
    hostname: null,
    serviceName: "ssh" as const,
    product: "OpenSSH",
    version: "9.6",
    source: "nmap" as const,
    parserVersion: "nmap-xml-v1",
    runId: "run-1",
    artifactId: "artifact-1",
    artifactDigest: `sha256:${"a".repeat(64)}`,
    observedAt: "2026-08-13T10:00:00.000Z",
  };

  it("uses a stable key that includes engagementId, an abort signal, and the shared services contract", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(response([service]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createAppQueryClient();

    await expect(client.fetchQuery(engagementServicesQueryOptions(engagement.id))).resolves.toEqual([
      service,
    ]);
    expect(engagementServicesQueryOptions(engagement.id).queryKey).toEqual(
      engagementServicesQueryKey(engagement.id),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/engagements/${engagement.id}/services`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    client.clear();
  });

  it("rejects extra fields and hides network details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response([{ ...service, secret: "/private/path" }]))),
    );
    const client = createAppQueryClient();
    await expect(client.fetchQuery(engagementServicesQueryOptions(engagement.id))).rejects.toMatchObject({
      name: "EngagementServicesQueryError",
      message: ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE,
    });
    expect(ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE).not.toContain("secret");
    client.clear();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("GET /api?token=secret failed at /private/path"))),
    );
    const retryClient = createAppQueryClient();
    try {
      await retryClient.fetchQuery(engagementServicesQueryOptions(engagement.id));
      throw new Error("Expected the engagement services query to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EngagementServicesQueryError);
      expect((error as Error).message).toBe(ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE);
      expect((error as Error).message).not.toContain("secret");
    } finally {
      retryClient.clear();
    }
  });

  it("does not read or expose bodies for unsupported HTTP statuses", async () => {
    const readBody = vi.fn(() => Promise.resolve({ token: "body-secret" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ json: readBody, ok: false, status: 500 } as unknown as Response)),
    );
    const client = createAppQueryClient();
    await expect(client.fetchQuery(engagementServicesQueryOptions(engagement.id))).rejects.toMatchObject({
      name: "EngagementServicesQueryError",
      message: ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE,
    });
    expect(readBody).not.toHaveBeenCalled();
    client.clear();
  });
});

describe("partitionEngagements", () => {
  it("separates active and archived records without inventing extras", () => {
    const archived = { ...engagement, id: "10000000-0000-4000-8000-000000000002", status: "archived" as const };
    expect(partitionEngagements([engagement, archived])).toEqual({
      active: [engagement],
      archived: [archived],
    });
    expect(partitionEngagements([])).toEqual({ active: [], archived: [] });
  });
});
