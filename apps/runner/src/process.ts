import { access, lstat, mkdir, realpath, stat as fsStat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { BoundedCollector, DEFAULT_COMBINED_RETAINED_OUTPUT } from "./bounded-output.js";
import { buildFakeActionArgv, controlledEnv, type FakeActionRequest } from "./fake-action.js";
import { createRedactor } from "./redaction.js";

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  stdoutMeta: import("./bounded-output.js").TruncationMeta;
  stderrMeta: import("./bounded-output.js").TruncationMeta;
  truncated: boolean;
  cleanupFailed?: boolean;
}

export interface RunDirectories {
  runDir: string;
  tmpDir: string;
}

export function isPathTraversalAttempt(value: string): boolean {
  return value.includes("..") || value.includes("\0") || path.isAbsolute(value) || value.includes(path.sep);
}

export function resolveRunDirPath(runRoot: string, runId: string, fence: string): string {
  if (runId.includes("..") || runId.includes("/") || runId.includes("\\") || runId.includes("\0")) {
    throw new Error("working_directory_escape");
  }
  if (fence.includes("..") || fence.includes("/") || fence.includes("\\") || fence.includes("\0")) {
    throw new Error("working_directory_escape");
  }
  const safeRunId = runId.replace(/[^a-zA-Z0-9:_\-]/g, "_");
  const dirname = `run-${safeRunId}-f${fence}`;
  if (dirname.includes("..") || dirname.includes("/") || dirname.includes("\\")) {
    throw new Error("working_directory_escape");
  }
  const runDir = path.join(runRoot, dirname);
  const resolved = path.resolve(runDir);
  const rootResolved = path.resolve(runRoot);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error("working_directory_escape");
  }
  return runDir;
}

export function resolveNmapXmlPath(runRoot: string, runId: string, fence: string): string {
  return path.join(resolveRunDirPath(runRoot, runId, fence), "nmap.xml");
}

export async function createRunDirectory(runRoot: string, runId: string, fence: string): Promise<RunDirectories> {
  const runDir = resolveRunDirPath(runRoot, runId, fence);
  await mkdir(runRoot, { recursive: true, mode: 0o700 }).catch(() => {
    throw new Error("working_directory_escape");
  });
  const rootLstat = await lstat(runRoot).catch(() => {
    throw new Error("working_directory_escape");
  });
  if (rootLstat.isSymbolicLink()) throw new Error("working_directory_escape");
  if (!rootLstat.isDirectory()) throw new Error("runRoot not a directory");
  const rootReal = await realpath(runRoot).catch(() => {
    throw new Error("working_directory_escape");
  });
  if (rootReal !== path.resolve(runRoot)) throw new Error("working_directory_escape");
  await mkdir(runDir, { recursive: false, mode: 0o700 }).catch(() => {
    throw new Error("working_directory_escape");
  });
  const dirLstat = await lstat(runDir).catch(() => {
    throw new Error("working_directory_escape");
  });
  if (dirLstat.isSymbolicLink()) throw new Error("working_directory_escape");
  if (!dirLstat.isDirectory()) throw new Error("working_directory_escape");
  const dirReal = await realpath(runDir).catch(() => {
    throw new Error("working_directory_escape");
  });
  if (dirReal !== path.resolve(runDir)) throw new Error("working_directory_escape");
  if (path.dirname(dirReal) !== rootReal) throw new Error("working_directory_escape");
  const tmpDir = path.join(runDir, "tmp");
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });
  return { runDir, tmpDir };
}

function validateExecutablePath(executable: string): void {
  if (executable.length === 0) throw new Error("executable required");
  if (executable.includes("\0")) throw new Error("executable contains NUL");
  if (!executable.startsWith("/")) throw new Error("executable must be absolute");
}

function validateArgv(argv: readonly string[]): void {
  for (const a of argv) if (a.includes("\0")) throw new Error("argv element contains NUL");
}

function spawnSupervised(params: {
  runId: string;
  leaseId: string;
  fence: string;
  runRoot: string;
  executable: string;
  argv: readonly string[];
  secrets?: readonly string[];
}): Promise<ProcessResult> & { cancel: () => Promise<void>; child?: ChildProcess } {
  const { runId, fence, runRoot, executable, argv, secrets } = params;
  let child: ChildProcess | undefined;
  let cancelRequested = false;
  let terminatedByRunner = false;
  let doCancel: () => Promise<void> = async () => {
    cancelRequested = true;
  };
  const promise = new Promise<ProcessResult>((resolve, reject) => {
    (async () => {
      try {
        validateExecutablePath(executable);
        validateArgv(argv);
        const { runDir } = await createRunDirectory(runRoot, runId, fence);
        const env = controlledEnv(runDir, undefined);
        for (const k of Object.keys(env)) {
          if (["LD_PRELOAD", "LD_LIBRARY_PATH"].includes(k)) throw new Error(`environment_variable_denied: ${k}`);
        }
        const stdoutRedactor = createRedactor({ secrets: secrets ?? [] });
        const stderrRedactor = createRedactor({ secrets: secrets ?? [] });
        const stdoutCollector = new BoundedCollector(DEFAULT_COMBINED_RETAINED_OUTPUT);
        const stderrCollector = new BoundedCollector(DEFAULT_COMBINED_RETAINED_OUTPUT);
        try {
          child = nodeSpawn(executable, [...argv], {
            cwd: runDir,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
            shell: false,
          });
        } catch (e) {
          reject(e);
          return;
        }
        const waitForClose = (cp: ChildProcess, timeoutMs: number): Promise<boolean> => {
          return new Promise((res) => {
            if (cp.exitCode !== null || cp.signalCode !== null) {
              res(true);
              return;
            }
            const onClose = (): void => {
              clearTimeout(timer);
              res(true);
            };
            const timer = setTimeout(() => {
              cp.off("close", onClose);
              res(false);
            }, timeoutMs);
            cp.once("close", onClose);
          });
        };
        doCancel = async () => {
          cancelRequested = true;
          if (child === undefined || child.pid === undefined) return;
          terminatedByRunner = true;
          const pgid = child.pid;
          try {
            process.kill(-pgid, "SIGTERM");
          } catch {
            try {
              child.kill("SIGTERM");
            } catch {}
          }
          const termDone = await waitForClose(child, 5000);
          if (termDone) return;
          try {
            process.kill(-pgid, "SIGKILL");
          } catch {
            try {
              child?.kill("SIGKILL");
            } catch {}
          }
          await waitForClose(child!, 2000);
          void terminatedByRunner;
        };
        (promise as unknown as { cancel: () => Promise<void> }).cancel = () => doCancel();
        (promise as unknown as { child?: ChildProcess }).child = child;
        const stdout = child.stdout;
        const stderr = child.stderr;
        if (stdout === null || stderr === null) {
          reject(new Error("missing stdio"));
          return;
        }
        stdout.on("data", (chunk: Buffer) => {
          const redacted = stdoutRedactor.push(chunk);
          stdoutCollector.push(chunk.length, redacted);
        });
        stderr.on("data", (chunk: Buffer) => {
          const redacted = stderrRedactor.push(chunk);
          stderrCollector.push(chunk.length, redacted);
        });
        child.on("error", (err) => reject(err));
        let closeEmitted = false;
        const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
          if (closeEmitted) return;
          closeEmitted = true;
          const stdoutTail = stdoutRedactor.flush();
          const stderrTail = stderrRedactor.flush();
          if (stdoutTail.length > 0) stdoutCollector.push(0, stdoutTail);
          if (stderrTail.length > 0) stderrCollector.push(0, stderrTail);
          const stdoutMeta = stdoutCollector.meta();
          const stderrMeta = stderrCollector.meta();
          const stillAlive = child !== undefined && child.exitCode === null && child.signalCode === null;
          resolve({
            exitCode: code,
            signal: signal as NodeJS.Signals | null,
            stdout: stdoutCollector.combined(),
            stderr: stderrCollector.combined(),
            stdoutMeta,
            stderrMeta,
            truncated: stdoutMeta.truncated || stderrMeta.truncated,
            cleanupFailed: stillAlive,
          });
        };
        child.on("close", onClose);
        if (cancelRequested) void doCancel();
      } catch (e) {
        reject(e);
      }
    })();
  }) as Promise<ProcessResult> & { cancel: () => Promise<void>; child?: ChildProcess };
  promise.cancel = () => doCancel();
  return promise;
}

export function runSupervised(
  request: FakeActionRequest & { runRoot: string; secrets?: string[]; executable?: string },
): Promise<ProcessResult> & { cancel: () => Promise<void>; child?: ChildProcess } {
  const executable = request.executable ?? process.execPath;
  const spec = buildFakeActionArgv(executable, request);
  const base = {
    runId: request.runId,
    leaseId: request.leaseId,
    fence: request.fence,
    runRoot: request.runRoot,
    executable: spec.executable,
    argv: spec.argv.slice(1) as readonly string[],
  } as const;
  if (request.secrets !== undefined) return spawnSupervised({ ...base, secrets: request.secrets });
  return spawnSupervised(base);
}

export function runSupervisedCommand(request: {
  runId: string;
  leaseId: string;
  fence: string;
  runRoot: string;
  executable: string;
  argv: readonly string[];
  secrets?: readonly string[];
}): Promise<ProcessResult> & { cancel: () => Promise<void>; child?: ChildProcess } {
  validateExecutablePath(request.executable);
  validateArgv(request.argv);
  return spawnSupervised(request);
}

export async function verifyExecutable(executable: string): Promise<void> {
  if (executable.includes("\0")) throw new Error("executable_path_not_absolute");
  if (!executable.startsWith("/")) throw new Error("executable_path_not_absolute");
  const st = await fsStat(executable);
  if (!st.isFile()) throw new Error("executable_not_regular_file");
  await access(executable, fsConstants.X_OK);
}
