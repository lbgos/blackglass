import { describe, expect, it } from "vitest";

import fixtureData from "../../../docs/architecture/fixtures/d2/runner-identity.json" with {
  type: "json",
};
import {
  ConfirmEnrollmentRequestSchema,
  ConfirmEnrollmentResponseSchema,
  InstallationFingerprintSchema,
  PersistedRunnerIdentitySchema,
  RunnerHandshakeRequestSchema,
  RunnerMutationErrorSchema,
  RunnerEvidenceGrantErrorSchema,
  RunnerProtocolUnsupportedErrorSchema,
  RunnerSecretSchema,
  StartEnrollmentChallengeRequestSchema,
  formatRunnerAuthorization,
  isRunnerControlRoute,
  parseRunnerAuthorizationHeader,
} from "./runner-api.js";
import { RUNNER_CONTROL_PROTOCOL } from "./runner-control.js";

const MUST_IMPLEMENT = [
  "d2.runner.enrollment-owner-confirmation",
  "d2.runner.enrollment-expired",
  "d2.runner.credential-hashed-at-rest",
  "d2.runner.route-separation",
  "d2.runner.protocol-handshake-accepted",
  "d2.runner.protocol-mismatch",
  "d2.runner.revocation-fences-work",
  "d2.runner.lost-credential-reenrollment",
] as const;

const DEFERRED: Record<string, string> = {
  "d2.runner.rotation-handover": "rotation handover / later owner",
  "d2.runner.required-capability-missing": "capability admission / later owner",
  "d2.runner.event-schema-unsupported": "event schema / later owner",
  "d2.runner.handshake-reports-abandoned-journals":
    "restart journals / later owner",
};

const fixtureFingerprint =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("runner identity contract fixture ownership", () => {
  it("implements or explicitly defers every D2 runner-identity case", () => {
    const implemented = new Set<string>(MUST_IMPLEMENT);
    for (const entry of fixtureData.cases) {
      const deferredOwner = DEFERRED[entry.id];
      if (deferredOwner !== undefined) {
        expect(implemented.has(entry.id), `${entry.id} must not be fake-passed`).toBe(
          false,
        );
        expect(deferredOwner.length).toBeGreaterThan(0);
        continue;
      }
      expect(implemented.has(entry.id), `${entry.id} has no owner`).toBe(true);
    }
  });
});

describe("runner API contracts", () => {
  it("accepts the enrollment confirmation envelope from the owner-confirmation fixture", () => {
    const spec = fixtureData.cases.find(
      (entry) => entry.id === "d2.runner.enrollment-owner-confirmation",
    );
    expect(spec).toBeDefined();
    expect(
      StartEnrollmentChallengeRequestSchema.safeParse({
        name: spec?.given.runnerName,
        installationFingerprint: spec?.given.installationFingerprint,
      }).success,
    ).toBe(true);
    expect(
      ConfirmEnrollmentRequestSchema.safeParse({ ownerConfirmed: true }).success,
    ).toBe(true);
    expect(
      ConfirmEnrollmentResponseSchema.safeParse({
        runner: {
          contractVersion: 1,
          id: "runner-fixture-1",
          revision: 1,
          name: "fixture-runner",
          installationFingerprint: fixtureFingerprint,
          status: "enabled",
          createdAt: "2026-08-09T12:00:00.000Z",
          updatedAt: "2026-08-09T12:00:00.000Z",
          revokedAt: null,
        },
        encoding: "base64url",
        credentialBytes: 32,
        secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }).success,
    ).toBe(true);
  });

  it("rejects a redisplayable identity document that includes verifier material", () => {
    expect(
      PersistedRunnerIdentitySchema.safeParse({
        contractVersion: 1,
        id: "runner-fixture-1",
        revision: 1,
        name: "fixture-runner",
        installationFingerprint: fixtureFingerprint,
        status: "enabled",
        createdAt: "2026-08-09T12:00:00.000Z",
        updatedAt: "2026-08-09T12:00:00.000Z",
        revokedAt: null,
        secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }).success,
    ).toBe(false);
    expect(RunnerSecretSchema.safeParse("not-a-secret").success).toBe(false);
    expect(InstallationFingerprintSchema.safeParse("sha256:zz").success).toBe(
      false,
    );
  });

  it("accepts runner-control-v1 handshake input and pins the 426 mismatch shape", () => {
    expect(
      RunnerHandshakeRequestSchema.safeParse({
        protocol: RUNNER_CONTROL_PROTOCOL,
        sessionId: "session-fixture-1",
        installationFingerprint: fixtureFingerprint,
        eventSchemas: ["runner-event-v1"],
        registryDigest: `sha256:${"b".repeat(64)}`,
      }).success,
    ).toBe(true);
    expect(
      RunnerProtocolUnsupportedErrorSchema.safeParse({
        code: "runner_protocol_unsupported",
        supported: [RUNNER_CONTROL_PROTOCOL],
      }).success,
    ).toBe(true);
    expect(
      RunnerMutationErrorSchema.safeParse({
        code: "runner_protocol_unsupported",
        supported: [RUNNER_CONTROL_PROTOCOL],
      }).success,
    ).toBe(true);
  });

  it("parses D3 grant admission errors as strict {code} objects", () => {
    for (const code of [
      "artifact_upload_in_progress",
      "artifact_quota_exceeded",
      "concurrent_upload_limit",
      "staging_quota_exceeded",
      "run_quota_exceeded",
      "total_quota_exceeded",
    ] as const) {
      expect(
        RunnerMutationErrorSchema.safeParse({ code }).success,
        code,
      ).toBe(true);
    }
    // Wire errors are objects, never bare strings.
    expect(RunnerMutationErrorSchema.safeParse("concurrent_upload_limit").success).toBe(
      false,
    );
    expect(RunnerEvidenceGrantErrorSchema.safeParse({ code: "stale_fence" }).success).toBe(
      false,
    );
  });

  it("separates runner control routes from operator enrollment and engagement routes", () => {
    expect(isRunnerControlRoute("/api/v1/runner/lease")).toBe(true);
    expect(isRunnerControlRoute("/api/v1/runner/handshake?x=1")).toBe(true);
    expect(isRunnerControlRoute("/api/v1/runners/enrollment-challenges")).toBe(
      false,
    );
    expect(isRunnerControlRoute("/api/v1/engagements")).toBe(false);
    expect(isRunnerControlRoute("/api/v1/actions")).toBe(false);
  });

  it("parses the runner selector and secret without treating operator headers as credentials", () => {
    const header = formatRunnerAuthorization(
      "runner-fixture-1",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(parseRunnerAuthorizationHeader(header)).toEqual({
      ok: true,
      runnerId: "runner-fixture-1",
      secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(parseRunnerAuthorizationHeader("Bearer operator-token")).toEqual({
      ok: false,
    });
    expect(parseRunnerAuthorizationHeader(undefined)).toEqual({ ok: false });
  });
});
