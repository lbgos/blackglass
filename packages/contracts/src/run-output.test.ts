import { describe, expect, it } from "vitest";

import {
  isOperatorRunOutputRoute,
  RUN_OUTPUT_MAX_BYTES,
  RUN_OUTPUT_MAX_CONTENT_CHARS,
  RunOutputErrorSchema,
  RunOutputResponseSchema,
} from "./run-output.js";

describe("run output contracts", () => {
  it("caps output text and requires truthful truncation flags", () => {
    expect(RUN_OUTPUT_MAX_BYTES).toBe(64 * 1024);
    expect(RUN_OUTPUT_MAX_CONTENT_CHARS).toBe(64 * 1024);
    const absent = {
      run: {
        id: "run-1",
        actionId: "action-1",
        state: "succeeded",
        terminalKind: "succeeded",
        terminalReason: null,
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
      stdout: { present: false, truncated: false, content: "" },
      stderr: { present: false, truncated: false, content: "" },
    };
    expect(RunOutputResponseSchema.safeParse(absent).success).toBe(true);
    const oversize = {
      ...absent,
      stdout: {
        present: true,
        artifactId: "artifact-1",
        sizeBytes: 10,
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        completeness: "complete",
        truncated: false,
        content: "x".repeat(RUN_OUTPUT_MAX_CONTENT_CHARS + 1),
      },
    };
    expect(RunOutputResponseSchema.safeParse(oversize).success).toBe(false);
  });

  it("matches only the operator run output routes", () => {
    expect(
      isOperatorRunOutputRoute("/api/v1/engagements/e/runs/r/output"),
    ).toBe(true);
    expect(
      isOperatorRunOutputRoute("/api/v1/engagements/e/runs/latest/output"),
    ).toBe(true);
    expect(
      isOperatorRunOutputRoute("/api/v1/engagements/e/runs/latest/output?x=1"),
    ).toBe(true);
    expect(isOperatorRunOutputRoute("/api/v1/engagements/e/runs/r/content")).toBe(
      false,
    );
    expect(isOperatorRunOutputRoute("/api/v1/runner/runs/r/output")).toBe(false);
  });

  it("covers operator error codes without em dash text", () => {
    for (const code of [
      "invalid_request",
      "engagement_not_found",
      "run_not_found",
      "no_terminal_run",
      "missing_artifact",
      "corrupt_artifact",
    ] as const) {
      expect(RunOutputErrorSchema.safeParse({ code }).success).toBe(true);
    }
  });
});
