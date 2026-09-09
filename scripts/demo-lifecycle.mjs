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
export function createChildRegistry() {
  const entries = [];
  return {
    track(child, exited) {
      const entry = { child, exited };
      entries.push(entry);
      return entry;
    },
    size() {
      return entries.length;
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
