import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { waitForApiReadiness } from "./dev-readiness.mjs";
import {
  DEMO_FIXTURE_HOST,
  assertLoopbackOrigin,
  assertLoopbackTarget,
  parseDemoArgs,
  resolveDemoPlan,
} from "./demo-config.mjs";
import { createChildRegistry, describeChildExit, trackExit } from "./demo-lifecycle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_READY_TIMEOUT_MS = 30_000;
const WEB_READY_TIMEOUT_MS = 30_000;
const NMAP_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 90_000;
const FFUF_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const TERMINAL_ACTION_STATES = new Set(["succeeded", "failed", "cancelled", "capability_error"]);
const WARNING_ACTION_STATES = new Set(["paused_for_warning", "active_paused_for_warning"]);
const FINDING_EVIDENCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,126}$/;

function fingerprint() {
  return `sha256:${createHash("sha256").update("stonehush-demo-lab-v1").digest("hex")}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Flat argv only: spawn(command, args) rejects nested arrays.
function spawnChild(command, args, { cwd, env }) {
  const child = spawn(command, args, { cwd, detached: true, env, shell: false, stdio: "inherit" });
  return { child, exited: trackExit(child) };
}

async function apiJson(base, method, urlPath, { body, idempotencyKey } = {}) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey !== undefined ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text.length === 0 ? null : JSON.parse(text);
  } catch {
    throw new Error(`${method} ${urlPath} returned non-JSON status ${response.status}.`);
  }
  if (response.status >= 400) {
    const code = payload !== null && typeof payload === "object" ? payload.code : undefined;
    const error = new Error(`${method} ${urlPath} failed status ${response.status}${code ? ` code ${code}` : ""}.`);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return payload;
}

async function waitForWebHealth(webBase, anyExit) {
  const deadline = Date.now() + WEB_READY_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    const settled = await Promise.race([
      fetch(`${webBase}/health`, { signal: AbortSignal.timeout(500) })
        .then(async (response) => ({ response }))
        .catch((error) => ({ error })),
      anyExit.then((result) => ({ exited: result })),
    ]);
    if ("exited" in settled) throw new Error("Web/API exited before web readiness.");
    if (!("error" in settled)) {
      try {
        const payload = await settled.response.json();
        if (settled.response.status === 200 && payload?.status === "ok") return;
      } catch {
        lastError = new Error("web health returned non-JSON");
      }
    } else {
      lastError = settled.error;
    }
    await delay(100);
  }
  throw new Error(`Web did not become ready. Last error: ${String(lastError)}`);
}

function latestSnapshot(action) {
  const snapshots = action?.action?.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error("Action response carries no snapshots.");
  }
  return snapshots[snapshots.length - 1];
}

async function driveActionToTerminal(apiBase, engagementId, actionId, { timeoutMs, label, checkExit, onUnexpectedExit }) {
  const deadline = Date.now() + timeoutMs;
  let continueAttempts = 0;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${label} did not finish before its timeout.`);
    const current = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}/actions/${actionId}`);
    const state = current?.action?.state;
    if (TERMINAL_ACTION_STATES.has(state)) {
      if (state !== "succeeded") throw new Error(`${label} ended terminal with state ${state}.`);
      return current;
    }
    // Terminal state wins over exit detection: a finished action is never
    // reported as a stall just because an idle child reaped first.
    const exited = await checkExit();
    if (exited !== null) {
      await onUnexpectedExit(exited);
      continue;
    }
    if (WARNING_ACTION_STATES.has(state)) {
      if (continueAttempts >= 3) throw new Error(`${label} warning continue exhausted retries.`);
      continueAttempts += 1;
      const snapshot = latestSnapshot(current);
      await apiJson(apiBase, "POST", `/api/v1/engagements/${engagementId}/actions/${actionId}/continue`, {
        body: {
          expectedRevision: current.revision,
          snapshotVersion: snapshot.version,
          snapshotBinding: snapshot.binding,
        },
        idempotencyKey: randomUUID(),
      });
      continue;
    }
    // Race resolving promises only: checkExit never rejects, so no
    // iteration leaks an unhandled rejection when a child dies.
    const stalled = await Promise.race([delay(POLL_INTERVAL_MS).then(() => null), checkExit()]);
    if (stalled !== null) {
      await onUnexpectedExit(stalled);
    }
  }
}

async function engagementRevision(apiBase, engagementId) {
  const detail = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}`);
  const revision = detail?.engagement?.revision;
  if (!Number.isInteger(revision) || revision < 1) throw new Error("Engagement detail carries no revision.");
  return revision;
}

function sectionRows(report, name) {
  const rows = report?.[name]?.rows;
  return Array.isArray(rows) ? rows : [];
}

function startFixture(fixturePort) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${DEMO_FIXTURE_HOST}:${fixturePort}`);
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><html><head><title>Demo Lab</title></head><body><h1>Demo Lab</h1><a href="/admin">admin</a></body></html>',
      );
    } else if (url.pathname === "/admin" || url.pathname === "/login") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>Demo ${url.pathname.slice(1)}</title></head><body>demo</body></html>`);
    } else {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: DEMO_FIXTURE_HOST, port: fixturePort }, () => resolve(server));
  });
}

async function main() {
  const plan = resolveDemoPlan({ args: parseDemoArgs(process.argv.slice(2)), repositoryRoot });
  const apiBase = `http://${DEMO_FIXTURE_HOST}:${plan.apiPort}`;
  const webBase = `http://${DEMO_FIXTURE_HOST}:${plan.webPort}`;
  const pnpmProgram = process.env.npm_execpath;
  if (!pnpmProgram) {
    console.error("pnpm executable path is unavailable. Run the demo with pnpm demo.");
    process.exitCode = 1;
    return;
  }
  // Current runner source through the existing tsx toolchain. tsx ships
  // as a shell wrapper, so it runs via pnpm exec (direct executable
  // resolution), never as a script argument to node. No dist, no compile.
  const runnerSrc = path.join(repositoryRoot, "apps", "runner", "src", "index.ts");

  const registry = createChildRegistry();
  // Live exit watchers, keyed by child label. Every pipeline stage throws
  // on any exit, so reaching keep-alive means no exit has happened yet.
  const liveExits = new Map();
  function watch(label, child, exited) {
    const entry = registry.track(child, exited, label);
    liveExits.set(
      label,
      exited.then(
        (result) => ({ label, ...result }),
        () => ({ label, code: 1, signal: null }),
      ),
    );
    return entry;
  }
  function checkExit() {
    return Promise.race([...liveExits.values(), Promise.resolve(null)]);
  }
  let fixture = null;
  let shutdownStarted = false;
  async function shutdown() {
    if (shutdownStarted) return;
    shutdownStarted = true;
    await registry.shutdown();
    if (fixture !== null) {
      await new Promise((resolve) => {
        try {
          fixture.closeAllConnections();
        } catch {
          // Older Node: fall through to close.
        }
        fixture.close(() => resolve());
        setTimeout(resolve, 2_000).unref?.();
      });
      fixture = null;
    }
  }
  // Single signal path with explicit exit codes. Interactive keep-alive
  // below also watches child health: a dead stack surfaces instead of
  // awaiting forever.
  let signalResolve = null;
  const gotSignal = new Promise((resolve) => {
    signalResolve = resolve;
  });
  process.once("SIGINT", () => signalResolve?.("SIGINT"));
  process.once("SIGTERM", () => signalResolve?.("SIGTERM"));

  try {
    await mkdir(plan.dataDir, { mode: 0o700, recursive: true });
    // The runner requires its run root to exist before the first lease;
    // otherwise run directory setup fails closed as nmap_unavailable.
    await mkdir(path.join(plan.dataDir, "runner", "runs"), { mode: 0o700, recursive: true });

    const wordlistPath = path.join(plan.dataDir, "wordlist.txt");
    await writeFile(wordlistPath, "admin\nlogin\ndashboard\nno-such-demo-path-zzz\n", { mode: 0o600 });

    fixture = await startFixture(plan.fixturePort);
    console.log(`Fixture listening on http://${DEMO_FIXTURE_HOST}:${plan.fixturePort}/`);

    const environment = {
      ...process.env,
      STONEHUSH_API_PORT: String(plan.apiPort),
      STONEHUSH_DATA_DIR: plan.dataDir,
      STONEHUSH_WEB_PORT: String(plan.webPort),
    };
    const apiSpawned = spawnChild(
      process.execPath,
      [pnpmProgram, "--filter", "@stonehush/api", "run", "dev"],
      { cwd: repositoryRoot, env: environment },
    );
    const api = watch("api", apiSpawned.child, apiSpawned.exited);
    await waitForApiReadiness({ exited: api.exited, url: `${apiBase}/health`, timeoutMs: API_READY_TIMEOUT_MS });
    console.log(`API ready at ${apiBase}.`);

    const webSpawned = spawnChild(
      process.execPath,
      [pnpmProgram, "--filter", "@stonehush/web", "run", "dev"],
      { cwd: repositoryRoot, env: environment },
    );
    const web = watch("web", webSpawned.child, webSpawned.exited);
    await waitForWebHealth(webBase, Promise.race([api.exited, web.exited]));
    console.log(`Web ready at ${webBase}/.`);

    const runnerName = `demo-lab-${Date.now()}`;
    const challenge = await apiJson(apiBase, "POST", "/api/v1/runners/enrollment-challenges", {
      body: { name: runnerName, installationFingerprint: fingerprint() },
      idempotencyKey: randomUUID(),
    });
    if (typeof challenge?.challengeId !== "string") throw new Error("Enrollment challenge returned no id.");
    const confirmed = await apiJson(
      apiBase,
      "POST",
      `/api/v1/runners/enrollment-challenges/${challenge.challengeId}/confirm`,
      { body: { ownerConfirmed: true }, idempotencyKey: randomUUID() },
    );
    const runnerId = confirmed?.runner?.id;
    const runnerSecret = confirmed?.secret;
    if (typeof runnerId !== "string" || typeof runnerSecret !== "string") {
      throw new Error("Enrollment confirm returned no runner credentials.");
    }
    console.log(`Runner enrolled as ${runnerName}.`);
    const runnerSpawned = spawnChild(
      process.execPath,
      [
        pnpmProgram,
        "--filter",
        "@stonehush/api",
        "exec",
        "tsx",
        "--conditions=development",
        runnerSrc,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...environment,
          STONEHUSH_API_BASE_URL: apiBase,
          STONEHUSH_RUNNER_ID: runnerId,
          STONEHUSH_RUNNER_SECRET: runnerSecret,
          STONEHUSH_RUNNER_DATA_DIR: path.join(plan.dataDir, "runner"),
          STONEHUSH_INSTALLATION_FINGERPRINT: fingerprint(),
          STONEHUSH_NMAP_EXECUTABLE: "/usr/bin/nmap",
        },
      },
    );
    watch("runner", runnerSpawned.child, runnerSpawned.exited);
    // Any unexpected child exit fails the stage truthfully. No respawn
    // path: idle-loop supervision is the runner's own fix (PR130).
    function onUnexpectedExit(stage, exit) {
      throw new Error(`${stage} stalled: ${describeChildExit(exit)}.`);
    }

    const created = await apiJson(apiBase, "POST", "/api/v1/engagements", {
      body: { name: "Demo lab", kind: "lab", autoContinueWarnings: false },
      idempotencyKey: randomUUID(),
    });
    const engagementId = created?.id;
    if (typeof engagementId !== "string") throw new Error("Engagement creation returned no id.");
    console.log(`Engagement created: ${engagementId}.`);

    const nmapTarget = "127.0.0.1";
    assertLoopbackTarget(nmapTarget, plan.fixturePort);
    const nmap = await apiJson(apiBase, "POST", `/api/v1/engagements/${engagementId}/actions`, {
      body: {
        expectedEngagementRevision: await engagementRevision(apiBase, engagementId),
        expectedActiveScopeRevisionId: null,
        targets: [nmapTarget],
        declaredPorts: [plan.fixturePort],
      },
      idempotencyKey: randomUUID(),
    });
    await driveActionToTerminal(apiBase, engagementId, nmap.action.actionId, {
      timeoutMs: NMAP_TIMEOUT_MS,
      label: "Nmap discovery",
      checkExit,
      onUnexpectedExit: (exit) => onUnexpectedExit("Nmap discovery", exit),
    });
    console.log("Nmap discovery succeeded.");

    const probeTarget = `http://${DEMO_FIXTURE_HOST}:${plan.fixturePort}/`;
    assertLoopbackOrigin(probeTarget, plan.fixturePort);
    const probe = await apiJson(apiBase, "POST", `/api/v1/engagements/${engagementId}/actions`, {
      body: {
        expectedEngagementRevision: await engagementRevision(apiBase, engagementId),
        expectedActiveScopeRevisionId: null,
        targets: [probeTarget],
      },
      idempotencyKey: randomUUID(),
    });
    await driveActionToTerminal(apiBase, engagementId, probe.action.actionId, {
      timeoutMs: PROBE_TIMEOUT_MS,
      label: "HTTP probe",
      checkExit,
      onUnexpectedExit: (exit) => onUnexpectedExit("HTTP probe", exit),
    });
    console.log("HTTP probe succeeded.");

    const origin = `http://${DEMO_FIXTURE_HOST}:${plan.fixturePort}`;
    assertLoopbackOrigin(origin, plan.fixturePort);
    const ffuf = await apiJson(apiBase, "POST", `/api/v1/engagements/${engagementId}/ffuf-discoveries`, {
      body: {
        expectedEngagementRevision: await engagementRevision(apiBase, engagementId),
        expectedActiveScopeRevisionId: null,
        origin,
        wordlistPath,
        rate: 10,
        threads: 5,
        timeoutSeconds: 5,
        maxTimeSeconds: 60,
        matchStatusCodes: [200],
      },
      idempotencyKey: randomUUID(),
    });
    await driveActionToTerminal(apiBase, engagementId, ffuf.action.actionId, {
      timeoutMs: FFUF_TIMEOUT_MS,
      label: "ffuf discovery",
      checkExit,
      onUnexpectedExit: (exit) => onUnexpectedExit("ffuf discovery", exit),
    });
    console.log("ffuf discovery succeeded.");

    const midReport = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}/report?format=json`);
    const services = sectionRows(midReport, "services");
    const probes = sectionRows(midReport, "probes");
    const ffufResults = sectionRows(midReport, "ffufResults");
    if (services.length === 0) throw new Error("Report carries no Nmap services.");
    if (probes.length === 0) throw new Error("Report carries no HTTP probes.");
    if (ffufResults.length === 0) throw new Error("Report carries no ffuf results.");
    const evidenceIds = sectionRows(midReport, "evidenceArtifacts")
      .map((entry) => entry?.artifactId)
      .filter((id) => typeof id === "string" && FINDING_EVIDENCE_ID_PATTERN.test(id))
      .slice(0, 4);

    await apiJson(apiBase, "POST", `/api/v1/engagements/${engagementId}/findings`, {
      body: {
        title: "Demo lab fixture port open",
        severity: "info",
        body: `Loopback fixture ${DEMO_FIXTURE_HOST}:${plan.fixturePort} answered Nmap, HTTP probe, and ffuf during the guided demo.`,
        evidenceArtifactIds: evidenceIds,
      },
      idempotencyKey: randomUUID(),
    });
    console.log("Finding recorded.");

    const notes = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}/notes`);
    if (notes === null || typeof notes !== "object" || !Number.isInteger(notes.revision)) {
      throw new Error("Notes read carries no revision; refusing revision-less write.");
    }
    const notesMarkdown = `# Demo lab\n\n- Fixture: http://${DEMO_FIXTURE_HOST}:${plan.fixturePort}/\n- Services: ${services.length}, probes: ${probes.length}, ffuf paths: ${ffufResults.length}\n`;
    try {
      await apiJson(apiBase, "PUT", `/api/v1/engagements/${engagementId}/notes`, {
        body: { markdown: notesMarkdown, expectedRevision: notes.revision },
        idempotencyKey: randomUUID(),
      });
    } catch (error) {
      if (error?.status === 409) {
        throw new Error("Notes write hit a revision conflict; refusing to overwrite blindly.");
      }
      throw error;
    }
    console.log("Notes saved.");

    // Fresh report AFTER finding and notes writes: the written bundle must
    // contain them, never the stale pre-write object.
    const report = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}/report?format=json`);
    const finalServices = sectionRows(report, "services");
    const finalProbes = sectionRows(report, "probes");
    const finalFfuf = sectionRows(report, "ffufResults");
    const finalFindings = Array.isArray(report?.findings) ? report.findings : [];
    const finalArtifacts = sectionRows(report, "evidenceArtifacts");
    if (finalServices.length === 0) throw new Error("Final report carries no Nmap services.");
    if (finalProbes.length === 0) throw new Error("Final report carries no HTTP probes.");
    if (finalFfuf.length === 0) throw new Error("Final report carries no ffuf results.");
    if (finalFindings.length === 0) throw new Error("Final report carries no findings.");
    if (typeof report?.notesMarkdown !== "string" || !report.notesMarkdown.includes(notesMarkdown)) {
      throw new Error("Final report JSON misses the demo notes.");
    }
    if (finalArtifacts.length === 0) throw new Error("Final report carries no evidence artifacts.");
    const proofArtifact = finalArtifacts[0]?.artifactId;
    if (typeof proofArtifact !== "string") throw new Error("Final report artifact carries no id.");
    const proofResponse = await fetch(
      `${apiBase}/api/v1/engagements/${engagementId}/artifacts/${encodeURIComponent(proofArtifact)}/content`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (proofResponse.status !== 200) throw new Error("Evidence artifact download failed.");
    const proofBytes = (await proofResponse.arrayBuffer()).byteLength;
    if (proofBytes === 0) throw new Error("Evidence artifact download is empty.");
    console.log(`Evidence proof: ${proofBytes} bytes from ${proofArtifact}.`);

    await writeFile(path.join(plan.dataDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    const markdownResponse = await fetch(`${apiBase}/api/v1/engagements/${engagementId}/report?format=markdown`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (markdownResponse.status !== 200) throw new Error("Report markdown export failed.");
    const markdown = await markdownResponse.text();
    if (!markdown.includes("## Notes") || !markdown.includes(notesMarkdown)) {
      throw new Error("Report markdown export misses the demo notes.");
    }
    await writeFile(path.join(plan.dataDir, "report.md"), markdown, { mode: 0o600 });

    console.log(`UI: ${webBase}/engagements/${engagementId}`);
    console.log(
      `Results: services ${finalServices.length}, probes ${finalProbes.length}, ffuf paths ${finalFfuf.length}, findings ${finalFindings.length}, artifacts ${finalArtifacts.length}, notes saved, report in ${plan.dataDir}.`,
    );
    if (plan.smoke) {
      console.log("Smoke pipeline proved; stopping.");
      await shutdown();
      return;
    }
    console.log("Demo running. Press Ctrl+C to stop; only demo-owned processes are cleaned up.");
    const settled = await Promise.race([gotSignal, registry.anyExit()]);
    await shutdown();
    if (settled === "SIGINT" || settled === "SIGTERM") {
      process.exitCode = settled === "SIGINT" ? 130 : 143;
      return;
    }
    console.error(`Demo stack unhealthy while running: ${describeChildExit(settled)}.`);
    process.exitCode = 1;
  } catch (error) {
    console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
    await shutdown();
    process.exitCode = 1;
  }
}

await main();
