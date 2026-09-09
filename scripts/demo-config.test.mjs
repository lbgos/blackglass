import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  assertLoopbackOrigin,
  assertLoopbackTarget,
  isLoopbackHostname,
  parseDemoArgs,
  resolveDemoPlan,
} from "./demo-config.mjs";

const ROOT = "/repo";

test("demo defaults avoid daily-driver ports and use a fresh directory", () => {
  const plan = resolveDemoPlan({ args: parseDemoArgs([]), repositoryRoot: ROOT, now: () => 123 });
  assert.equal(plan.apiPort, 3286);
  assert.equal(plan.webPort, 5286);
  assert.equal(plan.fixturePort, 43860);
  assert.equal(plan.dataDir, path.join(ROOT, ".stonehush", "demo-123"));
  assert.equal(plan.fresh, true);
});

test("demo rejects daily-driver and duplicate ports", () => {
  assert.throws(() => resolveDemoPlan({ args: parseDemoArgs(["--api-port", "3001"]), repositoryRoot: ROOT }), /daily-driver/);
  assert.throws(() => resolveDemoPlan({ args: parseDemoArgs(["--web-port", "5173"]), repositoryRoot: ROOT }), /daily-driver/);
  assert.throws(
    () => resolveDemoPlan({ args: parseDemoArgs(["--fixture-port", "3286"]), repositoryRoot: ROOT }),
    /differ/,
  );
});

test("demo rejects daily-driver storage and unknown flags", () => {
  assert.throws(
    () => resolveDemoPlan({ args: parseDemoArgs(["--data-dir", "/repo/.stonehush/dev"]), repositoryRoot: ROOT }),
    /daily-driver storage/,
  );
  assert.throws(() => parseDemoArgs(["--reset"]), /Unknown demo argument/);
});

test("demo targets stay on the loopback fixture port", () => {
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("example.com"), false);
  assertLoopbackOrigin("http://127.0.0.1:43860/", 43860);
  assert.throws(() => assertLoopbackOrigin("http://127.0.0.1:9999/", 43860), /dedicated fixture port/);
  assert.throws(() => assertLoopbackOrigin("http://example.com:43860/", 43860), /loopback/);
  assertLoopbackTarget("127.0.0.1", 43860);
  assert.throws(() => assertLoopbackTarget("192.0.2.10", 43860), /loopback/);
});
