import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { FFUF_DEFAULT_EXECUTABLE, runFfufDiscovery, type FfufRunnerDeps } from "./ffuf.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Sandbox scratch: all temp files stay under the worktree .tmp-ffuf-exec dir.
const scratchRoot = path.resolve(here, "../../.tmp-ffuf-exec");
const smokeWordlist = path.resolve(here, "../testdata/ffuf-smoke.txt");

const baseOptions = {
  origin: "http://127.0.0.1:3130",
  wordlistPath: "/lists/smoke.txt",
  outputJsonPath: "/runs/run-1/ffuf.json",
};

const context = { runId: "run-1", leaseId: "lease-1", fence: "1", runRoot: "/runs" };

function depsWith(overrides: Partial<FfufRunnerDeps> = {}): FfufRunnerDeps {
  return { runContext: context, ...overrides };
}

function ffufFileFixture(results: unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ results, time: "2026-09-03T00:00:00.000Z" }), "utf8");
}

const plantedRecord = {
  input: { FUZZ: "planted.txt" },
  position: 1,
  status: 200,
  length: 10,
  words: 1,
  lines: 2,
  redirectlocation: "",
  resultfile: "",
  url: "http://127.0.0.1:3130/planted.txt",
  host: "127.0.0.1:3130",
};

describe("runFfufDiscovery unit", () => {
  it("rejects contract violations without spawning", async () => {
    const spawn = vi.fn(async () => ({ exitCode: 0 }));
    const result = await runFfufDiscovery(depsWith({ spawn }), { ...baseOptions, origin: "ftp://x/" });
    expect(result).toEqual({ ok: false, error: { code: "invalid_ffuf_action_contract" } });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("passes argv arrays only to the spawn function", async () => {
    const spawn = vi.fn(async (_request: { executable: string; argv: readonly string[] }) => ({ exitCode: 0 }));
    const readOutputJson = vi.fn(async () => ffufFileFixture([]));
    const result = await runFfufDiscovery(depsWith({ spawn, readOutputJson }), baseOptions);
    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    const request = spawn.mock.calls[0]?.[0] as unknown as { executable: string; argv: readonly string[] };
    expect(request.executable).toBe(FFUF_DEFAULT_EXECUTABLE);
    expect(request.argv[0]).toBe("-u");
    expect(request.argv).toContain("/runs/run-1/ffuf.json");
    for (const element of request.argv) expect(typeof element).toBe("string");
  });

  it("drops extra raw keys and normalizes empty redirectlocation", async () => {
    const spawn = vi.fn(async () => ({ exitCode: 0 }));
    const readOutputJson = vi.fn(async () => ffufFileFixture([plantedRecord]));
    const result = await runFfufDiscovery(depsWith({ spawn, readOutputJson }), baseOptions);
    expect(result).toEqual({
      ok: true,
      output: {
        results: [
          {
            url: "http://127.0.0.1:3130/planted.txt",
            status: 200,
            length: 10,
            words: 1,
            lines: 2,
            input: { FUZZ: "planted.txt" },
          },
        ],
        truncated: false,
      },
      exitCode: 0,
    });
  });

  it("returns partial results with truncated true on non-zero exit", async () => {
    const spawn = vi.fn(async () => ({ exitCode: 1 }));
    const readOutputJson = vi.fn(async () => ffufFileFixture([plantedRecord]));
    const result = await runFfufDiscovery(depsWith({ spawn, readOutputJson }), baseOptions);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.results).toHaveLength(1);
      expect(result.output.truncated).toBe(true);
      expect(result.exitCode).toBe(1);
    }
  });

  it("marks signal termination as truncated when JSON is valid", async () => {
    const spawn = vi.fn(async () => ({ exitCode: null }));
    const readOutputJson = vi.fn(async () => ffufFileFixture([]));
    const result = await runFfufDiscovery(depsWith({ spawn, readOutputJson }), baseOptions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.truncated).toBe(true);
  });

  it("maps a missing binary to ffuf_missing", async () => {
    const spawn = vi.fn(async () => {
      throw Object.assign(new Error("spawn /usr/bin/ffuf ENOENT"), { code: "ENOENT" });
    });
    const result = await runFfufDiscovery(depsWith({ spawn }), baseOptions);
    expect(result).toEqual({ ok: false, error: { code: "ffuf_missing" } });
  });

  it("returns ffuf_parse_error and never throws on invalid JSON", async () => {
    const spawn = vi.fn(async () => ({ exitCode: 0 }));
    for (const bad of ["not json", '{"results": "nope"}', '{"nope": true}', ""]) {
      const readOutputJson = vi.fn(async () => Buffer.from(bad, "utf8"));
      let result: unknown;
      await expect(
        (async () => {
          result = await runFfufDiscovery(depsWith({ spawn, readOutputJson }), baseOptions);
        })(),
      ).resolves.toBeUndefined();
      expect(result).toEqual({ ok: false, error: { code: "ffuf_parse_error" } });
    }
  });

  it("returns ffuf_parse_error when the output file is missing", async () => {
    const spawn = vi.fn(async () => ({ exitCode: 0 }));
    const readOutputJson = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const result = await runFfufDiscovery(depsWith({ spawn, readOutputJson }), baseOptions);
    expect(result).toEqual({ ok: false, error: { code: "ffuf_parse_error" } });
  });

  it("returns ffuf_parse_error when a record fails the parser contract", async () => {
    const spawn = vi.fn(async () => ({ exitCode: 0 }));
    const readOutputJson = vi.fn(async () => ffufFileFixture([{ ...plantedRecord, status: 99 }]));
    const result = await runFfufDiscovery(depsWith({ spawn, readOutputJson }), baseOptions);
    expect(result).toEqual({ ok: false, error: { code: "ffuf_parse_error" } });
  });
});

const FFUF_AVAILABLE = existsSync(FFUF_DEFAULT_EXECUTABLE);
const FORBIDDEN_PORTS = new Set<number>([3001, 3101, 3111, 3112, 3113, 3120, 3121, 3122, 3123, 3124, 5193, 5194, 5195, 5196, 5197, 5198, 5199, 5200]);

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(): Promise<number> {
  for (let port = 3130; port < 3200; port += 1) {
    if (FORBIDDEN_PORTS.has(port)) continue;
    if (await probePort(port)) return port;
  }
  throw new Error("no free lab port");
}

function waitForTcp(port: number, deadlineMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > deadlineMs) {
          reject(new Error("lab server did not start"));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

describe.runIf(FFUF_AVAILABLE)("runFfufDiscovery against real ffuf 1.1.0", () => {
  it(
    "parses byte-true results for a planted file and omits 404s",
    async () => {
      const caseDir = path.join(scratchRoot, `e2e-${Date.now()}`);
      const labDir = path.join(caseDir, "lab");
      const runRoot = path.join(caseDir, "runs");
      let server: ChildProcess | null = null;
      try {
        await mkdir(labDir, { recursive: true, mode: 0o700 });
        await mkdir(runRoot, { recursive: true, mode: 0o700 });
        await chmod(caseDir, 0o700);
        // Content served byte-for-byte by python http.server; ffuf 1.1.0
        // reports this 10-byte body as length 10, words 1, lines 2.
        await writeFile(path.join(labDir, "planted.txt"), "hello-lab\n");
        expect(existsSync(smokeWordlist)).toBe(true);

        const port = await findFreePort();
        server = nodeSpawn("python3", ["-m", "http.server", String(port), "--directory", labDir], {
          cwd: caseDir,
          stdio: "ignore",
          detached: true,
          shell: false,
        });
        await waitForTcp(port, 10_000);

        const origin = `http://127.0.0.1:${port}`;
        const outputJsonPath = path.join(caseDir, "ffuf.json");
        const result = await runFfufDiscovery(
          {
            runContext: { runId: "ffuf-e2e", leaseId: "lease-e2e", fence: "1", runRoot },
          },
          {
            origin,
            wordlistPath: smokeWordlist,
            outputJsonPath,
            threads: 10,
            timeoutSeconds: 5,
            maxTimeSeconds: 60,
          },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.exitCode).toBe(0);
        expect(result.output.truncated).toBe(false);
        expect(result.output.results).toHaveLength(1);
        expect(result.output.results[0]).toEqual({
          url: `${origin}/planted.txt`,
          status: 200,
          length: 10,
          words: 1,
          lines: 2,
          input: { FUZZ: "planted.txt" },
        });
        // Raw file on disk agrees with the parsed projection.
        const raw = JSON.parse(await readFile(outputJsonPath, "utf8")) as {
          results: { url: string; status: number }[];
        };
        expect(raw.results.map((r) => r.url)).toEqual([`${origin}/planted.txt`]);
      } finally {
        if (server !== null && server.pid !== undefined) {
          try {
            process.kill(-server.pid, "SIGKILL");
          } catch {
            server.kill("SIGKILL");
          }
        }
        await rm(caseDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
