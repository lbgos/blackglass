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
  const dataDir = await mkdtemp(path.join(tmpdir(), "blackglass-demo-lifecycle-"));
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
