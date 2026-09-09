import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createChildRegistry, groupAlive, trackExit } from "./demo-lifecycle.mjs";
function spawnSleeper() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 250);"], {
    detached: true,
    shell: false,
    stdio: "ignore",
  });
  child.unref?.();
  return child;
}

test("shutdown cleans a live group and a failed start while preserving data", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "stonehush-demo-lifecycle-"));
  const marker = path.join(dataDir, "report.json");
  await writeFile(marker, '{"demo":true}\n');

  const registry = createChildRegistry();
  const failed = spawn(process.execPath, ["-e", "process.exit(1);"], {
    detached: true,
    shell: false,
    stdio: "ignore",
  });
  registry.track(failed, trackExit(failed));
  const sleeper = spawnSleeper();
  registry.track(sleeper, trackExit(sleeper));
  assert.equal(registry.size(), 2);

  await registry.shutdown();

  assert.equal(groupAlive(sleeper), false);
  assert.equal(groupAlive(failed), false);
  assert.equal(await readFile(marker, "utf8"), '{"demo":true}\n');
}, { timeout: 30_000 });

test("anyExit resolves with the first exit record while others keep running", async () => {
  const registry = createChildRegistry();
  const quick = spawn(process.execPath, ["-e", "process.exit(3);"], {
    detached: true,
    shell: false,
    stdio: "ignore",
  });
  registry.track(quick, trackExit(quick));
  const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 250);"], {
    detached: true,
    shell: false,
    stdio: "ignore",
  });
  registry.track(sleeper, trackExit(sleeper));

  const first = await registry.anyExit();
  assert.equal(first.code, 3);
  assert.equal(groupAlive(sleeper), true);
  await registry.shutdown();
  assert.equal(groupAlive(sleeper), false);
}, { timeout: 30_000 });

test("describeChildExit names the owning child for truthful failures", async () => {
  const { describeChildExit } = await import("./demo-lifecycle.mjs");
  assert.equal(
    describeChildExit({ label: "runner", pid: 7, code: 0 }),
    "demo child runner pid 7 exited code 0",
  );
  assert.match(describeChildExit({ label: "api", pid: 8, code: 1 }), /api/);
});

test("createStopState aborts promptly and guards new work", async () => {
  const { createStopState } = await import("./demo-lifecycle.mjs");
  const stop = createStopState();
  assert.equal(stop.stopping, false);
  stop.throwIfStopping("unit");
  let stoppedName = null;
  stop.stopped.then((name) => {
    stoppedName = name;
  });
  stop.requestStop("SIGINT");
  assert.equal(stop.stopping, true);
  assert.equal(stop.stopSignal.aborted, true);
  assert.throws(() => stop.throwIfStopping("unit"), /SIGINT/);
  await stop.stopped;
  assert.equal(stoppedName, "SIGINT");
  stop.requestStop("SIGTERM");
  assert.equal(stop.signalName, "SIGINT");
});

test("raceTickOrExit sleeps the full interval when idle, exits promptly", async () => {
  const { raceTickOrExit } = await import("./demo-lifecycle.mjs");
  let resolveExit = null;
  const pending = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const started = Date.now();
  const tick = await raceTickOrExit([pending], 120);
  assert.equal(tick.kind, "tick");
  assert.ok(Date.now() - started >= 100, "idle wait must not resolve immediately");
  const record = { label: "runner", pid: 9, code: 0 };
  const fast = await raceTickOrExit([Promise.resolve(record)], 10_000);
  assert.deepEqual(fast, { kind: "exit", exit: record });
  resolveExit(record);
}, { timeout: 30_000 });
