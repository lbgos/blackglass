import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { waitForApiReadiness } from "./dev-readiness.mjs";
import {
  DEMO_FIXTURE_HOST,
  assertLoopbackOrigin,
  assertLoopbackTarget,
  isResettableDataDir,
  parseDemoArgs,
  resolveDemoPlan,
} from "./demo-config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_READY_TIMEOUT_MS = 30_000;
const WEB_READY_TIMEOUT_MS = 30_000;
const RUNNER_BUILD_TIMEOUT_MS = 120_000;
const NMAP_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 90_000;
const FFUF_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 1_000;
const STOP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
const TERMINAL_ACTION_STATES = new Set(["succeeded", "failed", "cancelled", "capability_error"]);
const WARNING_ACTION_STATES = new Set(["paused_for_warning", "active_paused_for_warning"]);

function fingerprint() {
  return `sha256:${createHash("sha256").update("blackglass-demo-lab-v1").digest("hex")}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalGroup(child, signal) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function groupAlive(child) {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function stopChild(child, label) {
  if (!groupAlive(child)) {
    await child.exited;
    return;
  }
  signalGroup(child, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (groupAlive(child) && Date.now() < deadline) await delay(100);
  if (groupAlive(child)) signalGroup(child, "SIGKILL");
  await child.exited;
  void label;
}

function spawnChild(argv, { cwd, env }) {
  const [command, ...args] = argv;
  const child = spawn(command, args, { cwd, detached: true, env, shell: false, stdio: "inherit" });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exited };
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

async function waitForWebHealth(webBase, apiExited) {
  const deadline = Date.now() + WEB_READY_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    const settled = await Promise.race([
      fetch(`${webBase}/health`, { signal: AbortSignal.timeout(500) })
        .then(async (response) => ({ response }))
        .catch((error) => ({ error })),
      apiExited.then((result) => ({ exited: result })),
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

async function driveActionToTerminal(apiBase, engagementId, actionId, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  let continueAttempts = 0;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${label} did not finish before its timeout.`);
    const current = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}/actions/${actionId}`);
    const state = current?.action?.state;
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
    if (TERMINAL_ACTION_STATES.has(state)) {
      if (state !== "succeeded") throw new Error(`${label} ended terminal with state ${state}.`);
      return current;
    }
    await delay(POLL_INTERVAL_MS);
  }
}

async function engagementRevision(apiBase, engagementId) {
  const detail = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}`);
  const revision = detail?.engagement?.revision;
  if (!Number.isInteger(revision) || revision < 1) throw new Error("Engagement detail carries no revision.");
  return revision;
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
  const children = [];
  let fixture = null;
  const track = (entry) => {
    children.push(entry);
    return entry;
  };
  let shutdownStarted = false;
  async function shutdown() {
    if (shutdownStarted) return;
    shutdownStarted = true;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      try {
        await stopChild(children[index], "demo");
      } catch {
        // Shutdown is best-effort; the exit code already tells the truth.
      }
    }
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
  process.once("SIGINT", () => void shutdown().then(() => process.exit(130)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(143)));

  try {
    if (plan.reset) {
      if (!isResettableDataDir(plan.dataDir, repositoryRoot)) {
        throw new Error("--reset refused outside a demo-owned data directory.");
      }
      await rm(plan.dataDir, { force: true, recursive: true });
    }
    await mkdir(plan.dataDir, { mode: 0o700, recursive: true });

    const wordlistPath = path.join(plan.dataDir, "wordlist.txt");
    await writeFile(wordlistPath, "admin\nlogin\ndashboard\nno-such-demo-path-zzz\n", { mode: 0o600 });

    fixture = await startFixture(plan.fixturePort);
    console.log(`Fixture listening on http://${DEMO_FIXTURE_HOST}:${plan.fixturePort}/`);

    const environment = {
      ...process.env,
      BLACKGLASS_API_PORT: String(plan.apiPort),
      BLACKGLASS_DATA_DIR: plan.dataDir,
      BLACKGLASS_WEB_PORT: String(plan.webPort),
    };
    const api = track(
      spawnChild([process.execPath, [pnpmProgram, "--filter", "@blackglass/api", "run", "dev"]], {
        cwd: repositoryRoot,
        env: environment,
      }),
    );
    await waitForApiReadiness({ exited: api.exited, url: `${apiBase}/health`, timeoutMs: API_READY_TIMEOUT_MS });
    console.log(`API ready at ${apiBase}.`);

    const web = track(
      spawnChild([process.execPath, [pnpmProgram, "--filter", "@blackglass/web", "run", "dev"]], {
        cwd: repositoryRoot,
        env: environment,
      }),
    );
    await waitForWebHealth(webBase, Promise.race([api.exited, web.exited]));
    console.log(`Web ready at ${webBase}/.`);

    const runnerDist = path.join(repositoryRoot, "apps", "runner", "dist", "index.js");
    const { default: fsSync } = await import("node:fs");
    if (!fsSync.existsSync(runnerDist)) {
      console.log("Runner dist missing; building with existing toolchain.");
      const build = spawnSync(process.execPath, [pnpmProgram, "--filter", "@blackglass/runner", "build"], {
        cwd: repositoryRoot,
        env: environment,
        shell: false,
        timeout: RUNNER_BUILD_TIMEOUT_MS,
        encoding: "utf8",
      });
      if (build.status !== 0) {
        throw new Error(`Runner build failed status ${String(build.status)}: ${(build.stderr ?? "").slice(0, 500)}`);
      }
    }
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
    track(
      spawnChild([process.execPath, [runnerDist]], {
        cwd: repositoryRoot,
        env: {
          ...environment,
          BLACKGLASS_API_BASE_URL: apiBase,
          BLACKGLASS_RUNNER_ID: runnerId,
          BLACKGLASS_RUNNER_SECRET: runnerSecret,
          BLACKGLASS_RUNNER_DATA_DIR: path.join(plan.dataDir, "runner"),
          BLACKGLASS_INSTALLATION_FINGERPRINT: fingerprint(),
          BLACKGLASS_NMAP_EXECUTABLE: "/usr/bin/nmap",
        },
      }),
    );

    const created = await apiJson(apiBase, "POST", "/api/v1/engagements", {
      body: { name: "Demo lab", kind: "lab" },
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
    });
    console.log("ffuf discovery succeeded.");

    const report = await apiJson(apiBase, "GET", `/api/v1/engagements/${engagementId}/report`);
    const services = Array.isArray(report?.services) ? report.services : [];
    const probes = Array.isArray(report?.probes) ? report.probes : [];
    const ffufResults = Array.isArray(report?.ffufResults) ? report.ffufResults : [];
    if (services.length === 0) throw new Error("Report carries no Nmap services.");
    if (probes.length === 0) throw new Error("Report carries no HTTP probes.");
    if (ffufResults.length === 0) throw new Error("Report carries no ffuf results.");
    const evidenceIds = (Array.isArray(report?.evidenceArtifacts) ? report.evidenceArtifacts : [])
      .map((entry) => entry?.artifactId)
      .filter((id) => typeof id === "string")
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
    const notesBody = { markdown: `# Demo lab\n\n- Fixture: http://${DEMO_FIXTURE_HOST}:${plan.fixturePort}/\n- Services: ${services.length}, probes: ${probes.length}, ffuf paths: ${ffufResults.length}\n` };
    try {
      await apiJson(apiBase, "PUT", `/api/v1/engagements/${engagementId}/notes`, {
        body:
          notes !== null && typeof notes === "object" && Number.isInteger(notes.revision)
            ? { ...notesBody, expectedRevision: notes.revision }
            : notesBody,
        idempotencyKey: randomUUID(),
      });
    } catch (error) {
      if (error?.status === 409) {
        throw new Error("Notes write hit a revision conflict; refusing to overwrite blindly.");
      }
      throw error;
    }
    console.log("Notes saved.");

    await writeFile(path.join(plan.dataDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    const markdownResponse = await fetch(`${apiBase}/api/v1/engagements/${engagementId}/report?format=markdown`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (markdownResponse.status !== 200) throw new Error("Report markdown export failed.");
    await writeFile(path.join(plan.dataDir, "report.md"), await markdownResponse.text(), { mode: 0o600 });

    console.log(`UI: ${webBase}/engagements/${engagementId}`);
    console.log(
      `Results: services ${services.length}, probes ${probes.length}, ffuf paths ${ffufResults.length}, finding 1, notes saved, report in ${plan.dataDir}.`,
    );
    if (plan.smoke) {
      console.log("Smoke pipeline proved; stopping.");
      await shutdown();
      return;
    }
    console.log("Demo running. Press Ctrl+C to stop; only demo-owned processes are cleaned up.");
    await new Promise(() => undefined);
  } catch (error) {
    console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
    await shutdown();
    process.exitCode = 1;
  }
}

await main();
