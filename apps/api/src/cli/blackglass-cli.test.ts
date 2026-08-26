import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runBlackglassCli } from "./blackglass-cli.js";

const directories: string[] = [];

afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) continue;
    await rm(directory, { recursive: true, force: true });
  }
});

interface CliRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(
  argv: string[],
  environment: NodeJS.ProcessEnv,
): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runBlackglassCli(argv, environment, {
    writeOut: (line) => stdout.push(line),
    writeError: (line) => stderr.push(line),
  });
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("blackglass doctor CLI", () => {
  it("prints deterministic JSON and exits 0 for a healthy tree", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "doctor-cli-"));
    directories.push(directory);

    const native = await import("@blackglass/evidence-native");
    const loaded = native.loadEvidenceNative();
    if (!loaded.ok) throw new Error(`native binding unavailable: ${loaded.reason}`);
    const { EvidenceStore } = await import("../evidence/evidence-store.js");
    const storeResult = EvidenceStore.open(directory, loaded.binding);
    if (!storeResult.ok) throw new Error(`store open failed: ${storeResult.code}`);
    storeResult.store.close();
    // A migrated database with no rows keeps the report healthy.
    const { openEngagementDatabase } = await import("@blackglass/db");
    const database = openEngagementDatabase({ dataDirectory: directory });
    database.close();

    const first = await runCli(["doctor"], { BLACKGLASS_DATA_DIR: directory });
    expect(first.exitCode).toBe(0);
    expect(first.stderr).toBe("");
    const parsed = JSON.parse(first.stdout) as {
      status: string;
      report: { profile: string; healthy: boolean; fatal: boolean; findings: { code: string }[] };
    };
    expect(parsed).toEqual({
      status: "report",
      report: {
        profile: "d3-v1",
        healthy: true,
        fatal: false,
        findings: [{ code: "healthy" }],
      },
    });

    const second = await runCli(["doctor"], { BLACKGLASS_DATA_DIR: directory });
    expect(second.stdout).toBe(first.stdout);
  });

  it("exits 1 with defect JSON when the tree is unhealthy", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "doctor-cli-"));
    directories.push(directory);

    const native = await import("@blackglass/evidence-native");
    const loaded = native.loadEvidenceNative();
    if (!loaded.ok) throw new Error(`native binding unavailable: ${loaded.reason}`);
    const { EvidenceStore } = await import("../evidence/evidence-store.js");
    const storeResult = EvidenceStore.open(directory, loaded.binding);
    if (!storeResult.ok) throw new Error(`store open failed: ${storeResult.code}`);
    storeResult.store.close();
    // Untracked published entry: extra_artifact without any database row.
    const { openEngagementDatabase } = await import("@blackglass/db");
    const database = openEngagementDatabase({ dataDirectory: directory });
    database.close();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(directory, "evidence/published/extra-artifact"), "extra");

    const result = await runCli(["doctor"], { BLACKGLASS_DATA_DIR: directory });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      report: { healthy: boolean; findings: { code: string; artifactId?: string }[] };
    };
    expect(parsed.report.healthy).toBe(false);
    expect(parsed.report.findings).toContainEqual({
      code: "extra_artifact",
      artifactId: "extra-artifact",
    });
    expect(result.stdout).not.toContain(directory);
  });

  it("exits 2 on usage and configuration errors without touching stdout", async () => {
    const noArgs = await runCli([], {});
    expect(noArgs.exitCode).toBe(2);
    expect(noArgs.stdout).toBe("");

    const unknownCommand = await runCli(["repair"], {});
    expect(unknownCommand.exitCode).toBe(2);
    expect(unknownCommand.stderr).toContain("usage: blackglass doctor");

    const missingDataDir = await runCli(["doctor"], {});
    expect(missingDataDir.exitCode).toBe(2);
    expect(missingDataDir.stdout).toBe("");

    const relativeDataDir = await runCli(["doctor"], { BLACKGLASS_DATA_DIR: "relative/dir" });
    expect(relativeDataDir.exitCode).toBe(2);
    expect(relativeDataDir.stdout).toBe("");
  });
});
