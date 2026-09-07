import { describe, expect, it } from "vitest";

import {
  AdvisorTurnErrorSchema,
  AdvisorTurnListResponseSchema,
  AdvisorTurnSchema,
  CreateAdvisorTurnRequestSchema,
  parseAdvisorTurnListQuery,
} from "./advisor-turns.js";
import {
  commandJsonV1CreateAdvisorTurnDigest,
  projectCommandJsonV1DigestInput,
} from "./command-json-v1-digest.js";
import { canonicalizeJson, type JsonValue } from "./operator-command.js";

const ENGAGEMENT = "10000000-0000-4000-8000-000000000001";
const TURN = "20000000-0000-4000-8000-000000000002";
const STAMP = "2026-08-12T12:00:00.000Z";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    id: TURN,
    engagementId: ENGAGEMENT,
    question: "What does this evidence show?",
    modelId: "synthetic-test-model",
    redactions: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function cited(raw: string, valid: boolean, kind: string) {
  return { raw, valid, kind };
}

describe("advisor turn response coherence", () => {
  it("accepts a pending turn with coherent empty output", () => {
    expect(
      AdvisorTurnSchema.parse(
        baseTurn({ status: "pending", answer: "", uncertainty: "", citations: [], abstained: null, errorCode: null }),
      ),
    ).toMatchObject({ status: "pending" });
  });

  it("accepts grounded and abstained succeeded turns", () => {
    expect(
      AdvisorTurnSchema.parse(
        baseTurn({
          status: "succeeded",
          answer: "The banner shows HTTP.",
          uncertainty: "",
          citations: [cited("nmap-xml-1", true, "artifact")],
          abstained: false,
          errorCode: null,
        }),
      ),
    ).toMatchObject({ status: "succeeded" });
    expect(
      AdvisorTurnSchema.parse(
        baseTurn({
          status: "succeeded",
          answer: "Partial read: banner only.",
          uncertainty: "Version unknown.",
          citations: [cited("nmap-xml-1", true, "artifact")],
          abstained: true,
          errorCode: null,
        }),
      ),
    ).toMatchObject({ abstained: true });
  });

  it("rejects succeeded turns that violate P1 invariants", () => {
    for (const overrides of [
      { answer: "", uncertainty: "", citations: [], abstained: false },
      {
        answer: "Ungrounded.",
        uncertainty: "",
        citations: [],
        abstained: false,
      },
      {
        answer: "Bad citation.",
        uncertainty: "",
        citations: [cited("ghost", true, "unknown")],
        abstained: false,
      },
      {
        answer: "Dup citations.",
        uncertainty: "",
        citations: [
          cited("nmap-xml-1", true, "artifact"),
          cited("nmap-xml-1", true, "artifact"),
        ],
        abstained: false,
      },
    ]) {
      expect(
        AdvisorTurnSchema.safeParse(
          baseTurn({ status: "succeeded", errorCode: null, ...overrides }),
        ).success,
      ).toBe(false);
    }
  });

  it("accepts failed turns with allowlisted codes and rejects the rest", () => {
    expect(
      AdvisorTurnSchema.parse(
        baseTurn({
          status: "provider_error",
          answer: "",
          uncertainty: "",
          citations: [],
          abstained: null,
          errorCode: "provider_timeout",
        }),
      ),
    ).toMatchObject({ errorCode: "provider_timeout" });
    for (const turn of [
      baseTurn({
        status: "provider_error",
        answer: "",
        uncertainty: "",
        citations: [],
        abstained: null,
        errorCode: null,
      }),
      baseTurn({
        status: "provider_error",
        answer: "",
        uncertainty: "",
        citations: [],
        abstained: null,
        errorCode: "bogus",
      }),
      baseTurn({
        status: "cancelled",
        answer: "leaked",
        uncertainty: "",
        citations: [],
        abstained: null,
        errorCode: null,
      }),
      baseTurn({
        status: "cancelled",
        answer: "",
        uncertainty: "",
        citations: [],
        abstained: false,
        errorCode: null,
      }),
      baseTurn({
        status: "expired",
        answer: "",
        uncertainty: "",
        citations: [],
        abstained: null,
        errorCode: "provider_timeout",
      }),
      baseTurn({
        status: "pending",
        answer: "",
        uncertainty: "",
        citations: [],
        abstained: null,
        errorCode: "provider_timeout",
      }),
    ]) {
      expect(AdvisorTurnSchema.safeParse(turn).success).toBe(false);
    }
  });

  it("accepts the aliased P1 request body", () => {
    expect(
      CreateAdvisorTurnRequestSchema.parse({
        engagementId: ENGAGEMENT,
        question: "What does this evidence show?",
        excerptArtifactIds: ["nmap-xml-1"],
      }),
    ).toMatchObject({ findingIds: [] });
  });

  it("bounds list responses and validates error codes", () => {
    const pending = baseTurn({
      status: "pending",
      answer: "",
      uncertainty: "",
      citations: [],
      abstained: null,
      errorCode: null,
    });
    expect(
      AdvisorTurnListResponseSchema.parse({ turns: [pending], nextCursor: null }),
    ).toMatchObject({ turns: [{ status: "pending" }] });
    expect(
      AdvisorTurnListResponseSchema.safeParse({
        turns: Array.from({ length: 51 }, () => pending),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(AdvisorTurnErrorSchema.parse({ code: "turn_in_progress" })).toEqual({
      code: "turn_in_progress",
    });
    expect(AdvisorTurnErrorSchema.safeParse({ code: "bogus" }).success).toBe(false);
  });
});

describe("advisor turn list query", () => {
  it("defaults the limit and accepts a full cursor", () => {
    expect(parseAdvisorTurnListQuery({})).toEqual({ ok: true, value: { limit: 50 } });
    expect(parseAdvisorTurnListQuery({ limit: "10" })).toEqual({
      ok: true,
      value: { limit: 10 },
    });
    expect(
      parseAdvisorTurnListQuery({ limit: "5", beforeCreatedAt: STAMP, beforeId: TURN }),
    ).toEqual({
      ok: true,
      value: { limit: 5, before: { createdAt: STAMP, id: TURN } },
    });
  });

  it("rejects malformed scalar queries", () => {
    for (const query of [
      "limit=10",
      [],
      { limit: "0" },
      { limit: "51" },
      { limit: "10.5" },
      { limit: "" },
      { limit: ["10"] },
      { limit: "10", unknown: "x" },
      { beforeCreatedAt: STAMP },
      { beforeId: TURN },
      { beforeCreatedAt: "not-a-date", beforeId: TURN },
      { beforeCreatedAt: STAMP, beforeId: "" },
      { limit: "10", beforeCreatedAt: STAMP, beforeId: "x".repeat(256) },
    ]) {
      expect(parseAdvisorTurnListQuery(query)).toEqual({ ok: false });
    }
  });
});

describe("advisor turn digest projection", () => {
  function projected(body: Record<string, JsonValue>) {
    const projectedInput = projectCommandJsonV1DigestInput(commandJsonV1CreateAdvisorTurnDigest, {
      path: { engagementId: ENGAGEMENT },
      query: {},
      body: body as JsonValue,
    });
    const canonical = canonicalizeJson({
      actorId: "local-operator-v1",
      body: projectedInput.body,
      canonicalizationProfile: "command-json-v1",
      operation: "advisor_turn",
      path: projectedInput.path,
      query: projectedInput.query,
      route: `/api/v1/engagements/${ENGAGEMENT}/advisor/turns`,
    });
    if (!canonical.ok) throw new Error("canonical fixture failed");
    return canonical.canonicalJson;
  }

  it("binds the explicit ordered request while dropping the rest", () => {
    const body = {
      engagementId: ENGAGEMENT,
      question: "What does this show?",
      excerptArtifactIds: ["a-1", "a-2"],
      findingIds: ["f-1"],
      modelId: "other-model",
    };
    const minimal = {
      question: "What does this show?",
      excerptArtifactIds: ["a-1", "a-2"],
      findingIds: ["f-1"],
    };
    expect(projected(body)).toBe(projected(minimal));
    expect(projected(body)).toContain('"a-1","a-2"');
  });

  it("treats array order as significant", () => {
    const first = projected({
      question: "q",
      excerptArtifactIds: ["a-1", "a-2"],
      findingIds: [],
    });
    const second = projected({
      question: "q",
      excerptArtifactIds: ["a-2", "a-1"],
      findingIds: [],
    });
    expect(first).not.toBe(second);
  });
});
