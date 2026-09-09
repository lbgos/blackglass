import path from "node:path";

export const DEMO_DEFAULT_API_PORT = 3286;
export const DEMO_DEFAULT_WEB_PORT = 5286;
export const DEMO_DEFAULT_FIXTURE_PORT = 43860;

// Daily-driver development defaults. The demo never binds these ports and
// never stores data in the daily-driver directory.
export const DAILY_DRIVER_PORTS = [3001, 5173];
export const DAILY_DRIVER_DATA_DIRNAME = "dev";
export const DEMO_DATA_DIR_PREFIX = "demo-";
export const DEMO_FIXTURE_HOST = "127.0.0.1";

function readPortNumber(raw, name) {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be a decimal integer from 1 through 65535.`);
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a decimal integer from 1 through 65535.`);
  }
  return port;
}

export function parseDemoArgs(argv) {
  const args = {
    smoke: false,
    apiPort: undefined,
    webPort: undefined,
    fixturePort: undefined,
    dataDir: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--smoke") {
      args.smoke = true;
    } else if (token === "--api-port" || token === "--web-port" || token === "--fixture-port" || token === "--data-dir") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${token} requires a value.`);
      }
      index += 1;
      if (token === "--api-port") args.apiPort = value;
      else if (token === "--web-port") args.webPort = value;
      else if (token === "--fixture-port") args.fixturePort = value;
      else args.dataDir = value;
    } else {
      throw new Error(`Unknown demo argument: ${token}.`);
    }
  }
  return args;
}

function demoRoot(repositoryRoot) {
  return path.join(repositoryRoot, ".blackglass");
}

export function isDailyDriverDataDir(dataDir, repositoryRoot) {
  const resolved = path.resolve(dataDir);
  const driver = path.resolve(demoRoot(repositoryRoot), DAILY_DRIVER_DATA_DIRNAME);
  return resolved === driver || resolved.startsWith(driver + path.sep);
}

export function resolveDemoPlan({ args, repositoryRoot, now = () => Date.now() }) {
  if (!path.isAbsolute(repositoryRoot)) {
    throw new Error("The demo repository root must be absolute.");
  }
  const apiPort = args.apiPort === undefined ? DEMO_DEFAULT_API_PORT : readPortNumber(args.apiPort, "--api-port");
  const webPort = args.webPort === undefined ? DEMO_DEFAULT_WEB_PORT : readPortNumber(args.webPort, "--web-port");
  const fixturePort =
    args.fixturePort === undefined
      ? DEMO_DEFAULT_FIXTURE_PORT
      : readPortNumber(args.fixturePort, "--fixture-port");
  for (const [name, port] of [
    ["API", apiPort],
    ["web", webPort],
    ["fixture", fixturePort],
  ]) {
    if (DAILY_DRIVER_PORTS.includes(port)) {
      throw new Error(`${name} port ${port} is reserved for daily-driver development.`);
    }
  }
  if (new Set([apiPort, webPort, fixturePort]).size !== 3) {
    throw new Error("API, web, and fixture ports must all differ.");
  }
  let dataDir;
  let fresh = false;
  if (args.dataDir === undefined) {
    dataDir = path.join(demoRoot(repositoryRoot), `${DEMO_DATA_DIR_PREFIX}${now()}`);
    fresh = true;
  } else {
    if (args.dataDir.length === 0 || args.dataDir.includes("\0") || !path.isAbsolute(args.dataDir)) {
      throw new Error("--data-dir must be a non-empty absolute path without NUL bytes.");
    }
    dataDir = path.resolve(args.dataDir);
    if (isDailyDriverDataDir(dataDir, repositoryRoot)) {
      throw new Error("--data-dir must never point at daily-driver storage.");
    }
  }
  return { apiPort, webPort, fixturePort, dataDir, fresh, smoke: args.smoke };
}

// Loopback-only guard: every scan/probe target must stay on this host.
export function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  if (/^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(host)) return true;
  return host === "::ffff:127.0.0.1";
}

export function assertLoopbackOrigin(origin, fixturePort) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Demo origin is not a valid URL: ${origin}.`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`Demo origin must be plain http on the loopback fixture: ${origin}.`);
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error(`Demo origin must stay on loopback: ${origin}.`);
  }
  const port = url.port === "" ? 80 : Number(url.port);
  if (port !== fixturePort) {
    throw new Error(`Demo origin must use the dedicated fixture port ${fixturePort}: ${origin}.`);
  }
}

export function assertLoopbackTarget(target, fixturePort) {
  if (/^https?:\/\//i.test(target)) {
    assertLoopbackOrigin(target, fixturePort);
    return;
  }
  if (!isLoopbackHostname(target)) {
    throw new Error(`Demo scan target must stay on loopback: ${target}.`);
  }
}
