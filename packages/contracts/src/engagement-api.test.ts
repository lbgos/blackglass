import { describe, expect, it } from "vitest";

import {
  EngagementDetailResponseSchema,
  EngagementIdParamsSchema,
  EngagementListResponseSchema,
  EngagementMutationErrorSchema,
  EngagementRevisionRequestSchema,
  EngagementQueryErrorSchema,
  ScopeRevisionListResponseSchema,
  UpdateEngagementDeadlineRequestSchema,
} from "./engagement-api.js";

const engagement = {
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
} as const;

describe("engagement query API contracts", () => {
  it("composes bare list and detail responses from engagement contracts", () => {
    expect(EngagementListResponseSchema.parse([engagement])).toEqual([engagement]);
    expect(
      EngagementDetailResponseSchema.parse({
        engagement,
        activeScopeRevision: null,
      }),
    ).toEqual({ engagement, activeScopeRevision: null });
    expect(ScopeRevisionListResponseSchema.parse([])).toEqual([]);
  });

  it("accepts only a strict UUIDv4 engagement path parameter", () => {
    expect(
      EngagementIdParamsSchema.safeParse({ engagementId: engagement.id }).success,
    ).toBe(true);
    expect(
      EngagementIdParamsSchema.safeParse({ engagementId: "not-an-id" }).success,
    ).toBe(false);
    expect(
      EngagementIdParamsSchema.safeParse({
        engagementId: engagement.id,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("rejects reflective or unknown error fields", () => {
    expect(EngagementQueryErrorSchema.parse({ code: "storage_busy" })).toEqual({
      code: "storage_busy",
    });
    expect(
      EngagementQueryErrorSchema.safeParse({
        code: "invalid_persisted_data",
        path: "/private/data",
      }).success,
    ).toBe(false);
  });

  it("pins the deadline update request: explicit null clears, unknown rejected", () => {
    expect(
      UpdateEngagementDeadlineRequestSchema.parse({
        expectedRevision: 2,
        deadlineAt: "2026-08-14T12:00:00.000Z",
      }),
    ).toEqual({ expectedRevision: 2, deadlineAt: "2026-08-14T12:00:00.000Z" });
    expect(
      UpdateEngagementDeadlineRequestSchema.parse({ expectedRevision: 2, deadlineAt: null }),
    ).toEqual({ expectedRevision: 2, deadlineAt: null });
    expect(
      UpdateEngagementDeadlineRequestSchema.safeParse({ expectedRevision: 2 }).success,
    ).toBe(false);
    expect(
      UpdateEngagementDeadlineRequestSchema.safeParse({
        expectedRevision: 2,
        deadlineAt: "",
      }).success,
    ).toBe(false);
    expect(
      UpdateEngagementDeadlineRequestSchema.safeParse({
        expectedRevision: 2,
        deadlineAt: "tomorrow",
      }).success,
    ).toBe(false);
    expect(
      UpdateEngagementDeadlineRequestSchema.safeParse({
        expectedRevision: 2,
        deadlineAt: null,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("pins strict mutation revision and error responses", () => {
    expect(EngagementRevisionRequestSchema.parse({ expectedRevision: 1 })).toEqual({
      expectedRevision: 1,
    });
    expect(
      EngagementRevisionRequestSchema.safeParse({
        expectedRevision: 1,
        ignored: true,
      }).success,
    ).toBe(false);
    expect(
      EngagementMutationErrorSchema.parse({
        code: "revision_conflict",
        resourceType: "engagement",
        resourceId: engagement.id,
        currentRevision: 2,
      }),
    ).toEqual({
      code: "revision_conflict",
      resourceType: "engagement",
      resourceId: engagement.id,
      currentRevision: 2,
    });
    expect(
      EngagementMutationErrorSchema.safeParse({
        code: "storage_busy",
        path: "/private/data",
      }).success,
    ).toBe(false);
  });
});
