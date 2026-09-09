const STOP_GRACE_MS = 10_000;
const STOP_POLL_MS = 100;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// All helpers below take a real ChildProcess. Never pass a wrapper object:
// child.pid is undefined on wrappers, which silently disables signaling.
export function groupAlive(child) {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

export function signalGroup(child, signal) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export function trackExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function stopChild(child, exited, { graceMs = STOP_GRACE_MS } = {}) {
  if (!groupAlive(child)) {
    await exited;
    return;
  }
  signalGroup(child, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (groupAlive(child) && Date.now() < deadline) await delay(STOP_POLL_MS);
  if (groupAlive(child)) signalGroup(child, "SIGKILL");
  await exited;
}

// Registry owns only processes started by the caller. Shutdown stops them in
// reverse start order and never touches anything else on disk or in memory.
// anyExit() resolves with the first exit record so long waits can fail fast
// instead of hanging on a dead child.
export function createChildRegistry() {
  const entries = [];
  let notifyFirstExit = null;
  const firstExit = new Promise((resolve) => {
    notifyFirstExit = resolve;
  });
  return {
    track(child, exited) {
      const entry = { child, exited };
      entries.push(entry);
      exited.then(
        (result) => notifyFirstExit({ pid: child.pid ?? null, ...result }),
        () => notifyFirstExit({ pid: child.pid ?? null, code: 1, signal: null }),
      );
      return entry;
    },
    size() {
      return entries.length;
    },
    anyExit() {
      return firstExit;
    },
    async shutdown() {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        try {
          await stopChild(entries[index].child, entries[index].exited);
        } catch {
          // Shutdown is best-effort; the caller exit code tells the truth.
        }
      }
    },
  };
}

// Pure exit policy for a stalled pipeline stage. A clean (code 0) runner
// exit while work is still pending is the runner's idle drain, so a bounded
// respawn is safe. Anything else fails truthfully with the owning child.
export function classifyChildExit(exit, { restartsUsed, maxRestarts }) {
  if (exit.label !== "runner" || exit.code !== 0) {
    return {
      action: "fail",
      reason: `demo child ${exit.label} pid ${String(exit.pid)} exited code ${String(exit.code)}`,
    };
  }
  if (restartsUsed >= maxRestarts) {
    return { action: "fail", reason: "runner restart budget exhausted" };
  }
  return { action: "restart-runner" };
}
