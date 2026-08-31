import {
  AcquireRunnerLeaseRequestSchema,
  AcquireRunnerLeaseResponseSchema,
  NmapTcpConnectOptionsSchema,
  RunnerAppendStartedRequestSchema,
  RunnerCompleteRequestSchema,
  RunnerEventResponseSchema,
  RunnerHandshakeAcceptedResponseSchema,
  RunnerHandshakeRequestSchema,
  RunnerHeartbeatRequestSchema,
  RunnerHeartbeatResponseSchema,
  commandJsonV1RunnerAppendStartedDigest,
  commandJsonV1RunnerCompleteDigest,
} from "@blackglass/contracts";
import { buildNmapArgv } from "@blackglass/domain";

import { resolveRunnerConfig, type RunnerConfig } from "./config.js";
import { EvidencePublicationError, publishEvidenceArtifacts } from "./evidence-client.js";
import { getOrCreateOutboxEntry, removeOutboxAtomically } from "./outbox.js";
import { resolveNmapXmlPath, runSupervisedCommand, verifyExecutable } from "./process.js";

export type HandshakeResponse = ReturnType<typeof RunnerHandshakeAcceptedResponseSchema.parse>;
export type AcquiredLease = ReturnType<typeof AcquireRunnerLeaseResponseSchema.parse>;
export type HeartbeatResponse = ReturnType<typeof RunnerHeartbeatResponseSchema.parse>;
export type RunnerEventResponse = ReturnType<typeof RunnerEventResponseSchema.parse>;

export class RunnerShutdownError extends Error {
  readonly code = "runner_shutdown";
  constructor(message = "runner shutdown requested") {
    super(message);
    this.name = "RunnerShutdownError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunnerShutdownError();
}

function authHeader(runnerId: string, secret: string): string {
  return `Blackglass-Runner ${runnerId} ${secret}`;
}

function adaptToNmapOptions(typedOptions: unknown): unknown | null {
  if (typeof typedOptions !== "object" || typedOptions === null || Array.isArray(typedOptions)) return null;
  const strict = NmapTcpConnectOptionsSchema.safeParse(typedOptions);
  if (strict.success) return strict.data;
  const record = typedOptions as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "fixture" && record.fixture === true) {
    return {
      serviceDetection: true,
      timingTemplate: "T4",
      skipHostDiscovery: true,
      versionIntensity: 7,
      maxRetries: 2,
    };
  }
  if (keys.length !== 1 || keys[0] !== "declaredPorts") return null;
  const declared = record.declaredPorts;
  if (declared === null) {
    return {
      serviceDetection: true,
      timingTemplate: "T4",
      skipHostDiscovery: true,
      versionIntensity: 7,
      maxRetries: 2,
    };
  }
  if (!Array.isArray(declared)) return null;
  const ports: { from: number; to: number }[] = [];
  for (const p of declared) {
    if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > 65535) return null;
    ports.push({ from: p, to: p });
  }
  const base: Record<string, unknown> = {
    serviceDetection: true,
    timingTemplate: "T4",
    skipHostDiscovery: true,
    versionIntensity: 7,
    maxRetries: 2,
  };
  if (ports.length > 0) base.ports = ports;
  return base;
}

export async function handshake(config: RunnerConfig): Promise<HandshakeResponse> {
  const url = `${config.apiBaseUrl}/api/v1/runner/handshake`;
  const rawBody = RunnerHandshakeRequestSchema.parse({
    protocol: "runner-control-v1",
    sessionId: config.sessionId,
    installationFingerprint: config.installationFingerprint,
    eventSchemas: ["runner-event-v1"],
    capabilities: [],
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(config.runnerId, config.secret),
    },
    body: JSON.stringify(rawBody),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`handshake failed ${res.status}: ${text}`);
  }
  const json = await res.json();
  return RunnerHandshakeAcceptedResponseSchema.parse(json);
}

export async function acquireLease(
  config: RunnerConfig,
): Promise<AcquiredLease | null> {
  const url = `${config.apiBaseUrl}/api/v1/runner/lease`;
  const rawBody = AcquireRunnerLeaseRequestSchema.parse({ sessionId: config.sessionId });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(config.runnerId, config.secret),
    },
    body: JSON.stringify(rawBody),
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === "no_work") return null;
    throw new Error(`lease acquire 409 ${body.code}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`acquireLease failed ${res.status}: ${text}`);
  }
  const json = await res.json();
  return AcquireRunnerLeaseResponseSchema.parse(json);
}

export async function heartbeat(
  config: RunnerConfig,
  lease: AcquiredLease["lease"],
  sequence: number,
): Promise<HeartbeatResponse> {
  const url = `${config.apiBaseUrl}/api/v1/runner/leases/${lease.leaseId}/heartbeat`;
  const rawBody = RunnerHeartbeatRequestSchema.parse({
    runId: lease.runId,
    sessionId: lease.sessionId,
    fence: lease.fence,
    heartbeatSequence: sequence,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(config.runnerId, config.secret),
    },
    body: JSON.stringify(rawBody),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    const code = body?.code ?? `http_${res.status}`;
    const err = new Error(`heartbeat failed ${code}`) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return RunnerHeartbeatResponseSchema.parse(json);
}

export async function appendStarted(
  config: RunnerConfig,
  lease: AcquiredLease["lease"],
  sequence: number,
): Promise<RunnerEventResponse> {
  const url = `${config.apiBaseUrl}/api/v1/runner/leases/${lease.leaseId}/events`;
  const route = `/api/v1/runner/leases/${lease.leaseId}/events`;
  const rawBody = RunnerAppendStartedRequestSchema.parse({
    runId: lease.runId,
    sessionId: lease.sessionId,
    fence: lease.fence,
    sequence,
    payload: { startedAt: new Date().toISOString() },
  });
  const { entry } = await getOrCreateOutboxEntry({
    dataDir: config.dataDir,
    actorId: config.runnerId,
    route,
    operation: "append_started",
    path: { leaseId: lease.leaseId },
    query: {},
    body: rawBody as unknown as import("@blackglass/contracts").JsonValue,
    digestProjection: commandJsonV1RunnerAppendStartedDigest,
  });
  const key = entry.key;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: authHeader(config.runnerId, config.secret),
        "idempotency-key": key,
      },
      body: JSON.stringify(rawBody),
    });
  } catch (e) {
    throw e;
  }
  try {
    await removeOutboxAtomically(config.dataDir, key);
  } catch (e) {
    throw new Error(`outbox removal failed: ${String(e)}`);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { code?: string; expectedSequence?: number };
    const err = new Error(`appendStarted failed ${res.status} ${j.code ?? ""}`) as Error & { code?: string };
    if (j.code !== undefined) (err as { code?: string }).code = j.code;
    throw err;
  }
  const json = await res.json();
  return RunnerEventResponseSchema.parse(json);
}

export async function completeRun(
  config: RunnerConfig,
  lease: AcquiredLease["lease"],
  sequence: number,
  terminalKind: "succeeded" | "failed" | "cancelled",
  reason: string | null,
): Promise<RunnerEventResponse> {
  const url = `${config.apiBaseUrl}/api/v1/runner/leases/${lease.leaseId}/complete`;
  const route = `/api/v1/runner/leases/${lease.leaseId}/complete`;
  const rawBody = RunnerCompleteRequestSchema.parse({
    runId: lease.runId,
    sessionId: lease.sessionId,
    fence: lease.fence,
    sequence,
    terminalKind,
    reason,
  });
  const { entry } = await getOrCreateOutboxEntry({
    dataDir: config.dataDir,
    actorId: config.runnerId,
    route,
    operation: "complete",
    path: { leaseId: lease.leaseId },
    query: {},
    body: rawBody as unknown as import("@blackglass/contracts").JsonValue,
    digestProjection: commandJsonV1RunnerCompleteDigest,
  });
  const key = entry.key;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: authHeader(config.runnerId, config.secret),
        "idempotency-key": key,
      },
      body: JSON.stringify(rawBody),
    });
  } catch (e) {
    throw e;
  }
  try {
    await removeOutboxAtomically(config.dataDir, key);
  } catch (e) {
    throw new Error(`outbox removal failed: ${String(e)}`);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    const err = new Error(`complete failed ${res.status} ${j.code ?? ""}`) as Error & { code?: string };
    if (j.code !== undefined) (err as { code?: string }).code = j.code;
    throw err;
  }
  const json = await res.json();
  return RunnerEventResponseSchema.parse(json);
}

/**
 * Single-iteration Nmap execution: handshake -> lease -> started -> heartbeat -> Nmap spawn -> complete.
 * Nmap argv is derived deterministically from acquired.actionSnapshot before spawn using the controlled run directory.
 * Invalid snapshot or unusable executable completes with a fixed non-reflective reason without spawn.
 */
export async function runOnce(
  overrides: Partial<RunnerConfig> = {},
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const signal = opts.signal;
  throwIfAborted(signal);
  const config = resolveRunnerConfig(overrides);
  if (config.runnerId === "" || config.secret === "") {
    throw new Error("runner credentials required (BLACKGLASS_RUNNER_ID/SECRET)");
  }

  throwIfAborted(signal);
  await handshake(config);
  throwIfAborted(signal);

  const leaseSendMonotonic = globalThis.performance.now();
  const acquired = await acquireLease(config);
  throwIfAborted(signal);
  if (acquired === null) return false;

  const lease = acquired.lease;

  try {
    throwIfAborted(signal);
    await appendStarted(config, lease, 1);
    throwIfAborted(signal);
  } catch (e) {
    if (e instanceof RunnerShutdownError) {
      try {
        await completeRun(config, lease, 2, "failed", "runner_lost");
      } catch {}
      throw e;
    }
    throw e;
  }

  let authorityDeadlineMonotonic = leaseSendMonotonic + config.leaseDurationMs;
  let hbSeq = 1;
  let hbTimer: ReturnType<typeof setInterval> | null = null;
  let hbFailed = false;
  let shutdownAfterStarted = false;
  const onAbortAfterStarted = (): void => {
    shutdownAfterStarted = true;
  };
  if (signal) {
    if (signal.aborted) shutdownAfterStarted = true;
    else signal.addEventListener("abort", onAbortAfterStarted, { once: true });
  }

  const startHeartbeat = (): void => {
    hbTimer = setInterval(() => {
      if (signal?.aborted) {
        hbFailed = true;
        if (hbTimer !== null) clearInterval(hbTimer);
        return;
      }
      const hbSendMonotonic = globalThis.performance.now();
      const nextSeq = hbSeq + 1;
      void heartbeat(config, lease, nextSeq)
        .then(() => {
          hbSeq = nextSeq;
          authorityDeadlineMonotonic = hbSendMonotonic + config.leaseDurationMs;
        })
        .catch((e: unknown) => {
          const code = (e as { code?: string })?.code;
          if (code === "stale_fence" || code === "lease_expired" || code === "lease_owner_mismatch") {
            hbFailed = true;
            if (hbTimer !== null) clearInterval(hbTimer);
          }
        });
    }, config.heartbeatIntervalMs);
    if (hbTimer !== null && typeof (hbTimer as unknown as { unref?: () => void }).unref === "function") {
      (hbTimer as unknown as { unref: () => void }).unref?.();
    }
  };
  startHeartbeat();

  const cleanup = (): void => {
    if (hbTimer !== null) clearInterval(hbTimer);
    if (signal) signal.removeEventListener("abort", onAbortAfterStarted);
  };

  // Build and validate Nmap command from immutable snapshot before spawn
  let nmapArgv: readonly string[] | null = null;
  let earlyReason: string | null = null;
  try {
    const xmlPath = resolveNmapXmlPath(config.runRoot, lease.runId, lease.fence);
    const snapshot: unknown = (acquired as unknown as { actionSnapshot: unknown }).actionSnapshot;
    const snap = snapshot as { typedOptions: unknown; canonicalTargets: unknown };
    const adapted = adaptToNmapOptions(snap.typedOptions);
    if (adapted === null) {
      earlyReason = "invalid_action_snapshot";
    } else {
      const built = buildNmapArgv({ options: adapted, canonicalTargets: snap.canonicalTargets as never, xmlPath });
      if (!built.ok) {
        earlyReason = "invalid_action_snapshot";
      } else {
        nmapArgv = built.argv;
        if (config.executable.includes("\0") || !config.executable.startsWith("/")) {
          earlyReason = "nmap_unavailable";
          nmapArgv = null;
        } else {
          for (const a of nmapArgv as readonly string[]) if (a.includes("\0")) { earlyReason = "nmap_unavailable"; nmapArgv = null; break; }
          if (earlyReason === null) {
            try {
              await verifyExecutable(config.executable);
            } catch {
              earlyReason = "nmap_unavailable";
              nmapArgv = null;
            }
          }
        }
      }
    }
  } catch {
    earlyReason = "invalid_action_snapshot";
    nmapArgv = null;
  }

  if (signal?.aborted || shutdownAfterStarted) {
    earlyReason = null;
    nmapArgv = null;
  }

  if (earlyReason !== null) {
    cleanup();
    if (signal?.aborted || shutdownAfterStarted) {
      await completeRun(config, lease, 2, "failed", "runner_lost").catch(() => {});
      if (signal?.aborted) throw new RunnerShutdownError();
      return true;
    }
    await completeRun(config, lease, 2, "failed", earlyReason).catch(() => {});
    return true;
  }

  if (nmapArgv === null) {
    cleanup();
    await completeRun(config, lease, 2, "failed", "invalid_action_snapshot").catch(() => {});
    return true;
  }

  let result: Awaited<ReturnType<typeof runSupervisedCommand>> | null = null;
  let cancelledByFence = false;
  let handle: ReturnType<typeof runSupervisedCommand> | null = null;
  let fenceCheck: ReturnType<typeof setInterval> | null = null;

  const fullCleanup = (): void => {
    if (fenceCheck !== null) clearInterval(fenceCheck);
    cleanup();
  };

  try {
    throwIfAborted(signal);
    handle = runSupervisedCommand({
      runId: lease.runId,
      leaseId: lease.leaseId,
      fence: lease.fence,
      runRoot: config.runRoot,
      executable: config.executable,
      argv: nmapArgv,
      secrets: [config.secret],
    });

    if (signal?.aborted || shutdownAfterStarted) {
      cancelledByFence = true;
      void handle.cancel();
    }

    fenceCheck = setInterval(() => {
      const nowMonotonic = globalThis.performance.now();
      if (nowMonotonic >= authorityDeadlineMonotonic - 7000 || hbFailed || signal?.aborted || shutdownAfterStarted) {
        cancelledByFence = true;
        void handle?.cancel();
        if (fenceCheck !== null) clearInterval(fenceCheck);
      }
    }, 500);
    if (typeof (fenceCheck as unknown as { unref?: () => void }).unref === "function") {
      (fenceCheck as unknown as { unref: () => void }).unref?.();
    }

    result = await handle;
    if (fenceCheck !== null) clearInterval(fenceCheck);
  } finally {
    fullCleanup();
  }

  if (signal?.aborted || shutdownAfterStarted) {
    cancelledByFence = true;
  }

  const isCancelledForEvidence = cancelledByFence || hbFailed || Boolean(signal?.aborted) || shutdownAfterStarted;

  if (isCancelledForEvidence) {
    if (result !== null) {
      try {
        await publishEvidenceArtifacts(config, lease, result, { isCancelled: true });
      } catch {}
    }
    await completeRun(config, lease, 2, "failed", "runner_lost").catch(() => {});
    if (signal?.aborted) throw new RunnerShutdownError();
    return true;
  }

  if (result !== null) {
    try {
      await publishEvidenceArtifacts(config, lease, result, { isCancelled: false });
    } catch (e) {
      try {
        await completeRun(config, lease, 2, "failed", "evidence_publication_failed");
      } catch {}
      if (e instanceof EvidencePublicationError) throw e;
      throw new EvidencePublicationError("evidence_publication_failed");
    }
  }

  const terminalKind = result !== null && result.exitCode === 0 ? "succeeded" : "failed";
  const reason: string | null = terminalKind === "succeeded" ? null : "process_failed";
  await completeRun(config, lease, 2, terminalKind, reason);
  return true;
}

export function createRunnerLoop(configOverrides: Partial<RunnerConfig> = {}): {
  start: () => void;
  stop: () => Promise<void>;
  isStopped: () => boolean;
} {
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerResolve: (() => void) | null = null;
  let abortController: AbortController | null = null;
  let inFlight: Promise<boolean> | null = null;
  let loopPromise: Promise<void> | null = null;

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((res) => {
      timerResolve = res;
      timer = setTimeout(() => {
        timer = null;
        timerResolve = null;
        res();
      }, ms);
      timer.unref?.();
    });

  const loop = async (): Promise<void> => {
    while (!stopped) {
      if (abortController === null || abortController.signal.aborted) {
        abortController = new AbortController();
      }
      const signal = abortController.signal;
      try {
        inFlight = runOnce(configOverrides, { signal });
        const didWork = await inFlight;
        inFlight = null;
        if (stopped) break;
        await sleep(didWork ? 100 : 1000);
      } catch (e) {
        inFlight = null;
        if (e instanceof RunnerShutdownError) {
          break;
        }
        if (stopped) break;
        await sleep(2000);
      }
    }
  };

  return {
    start() {
      if (loopPromise !== null) return;
      stopped = false;
      stopPromise = null;
      abortController = new AbortController();
      loopPromise = loop();
      loopPromise.catch(() => {});
    },
    stop(): Promise<void> {
      if (stopPromise !== null) return stopPromise;
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (timerResolve !== null) {
        const res = timerResolve;
        timerResolve = null;
        res();
      }
      abortController?.abort();
      stopPromise = (async () => {
        if (inFlight !== null) {
          try {
            await inFlight;
          } catch {}
        }
        if (loopPromise !== null) {
          try {
            await loopPromise;
          } catch {}
        }
      })();
      return stopPromise;
    },
    isStopped(): boolean {
      return stopped;
    },
  };
}
