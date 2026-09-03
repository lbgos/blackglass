import {
  HTTP_PROBE_MAX_BODY_BYTES,
  HTTP_PROBE_MAX_HOPS,
  type ActionSnapshot,
  type HttpProbeErrorCode,
  type HttpProbeHop,
  type HttpProbeRaw,
} from "@blackglass/contracts";
import {
  buildProbeRawBytes,
  isHttpProbeSnapshot,
  parseProbeTitle,
  probeUrlsForSnapshot,
  selectProbeHeaders,
} from "@blackglass/domain";

export const HTTP_PROBE_TIMEOUT_MS = 15_000;

export type ProbeFetch = (
  url: string,
  init?: { redirect?: RequestRedirect; signal?: AbortSignal | null },
) => Promise<{
  status: number;
  headers: Iterable<readonly [string, string]>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function probeUrlsFromSnapshot(snapshot: ActionSnapshot): string[] | null {
  if (!isHttpProbeSnapshot(snapshot)) return null;
  return probeUrlsForSnapshot(snapshot);
}

function redirectLocation(status: number, location: string | null): string | null {
  if (
    (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) &&
    location !== null &&
    location.length > 0
  ) {
    return location;
  }
  return null;
}

function headerEntries(
  headers: Iterable<readonly [string, string]>,
): [string, string][] {
  const entries: [string, string][] = [];
  for (const [name, value] of headers) entries.push([name, value]);
  return entries;
}

function locationOf(entries: [string, string][]): string | null {
  for (const [name, value] of entries) {
    if (name.toLowerCase() === "location") return value;
  }
  return null;
}

async function readBoundedBodyText(
  response: { arrayBuffer(): Promise<ArrayBuffer> },
): Promise<{ text: string; tooLarge: boolean }> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > HTTP_PROBE_MAX_BODY_BYTES) {
    return {
      text: buffer.subarray(0, HTTP_PROBE_MAX_BODY_BYTES).toString("utf8"),
      tooLarge: true,
    };
  }
  return { text: buffer.toString("utf8"), tooLarge: false };
}

/**
 * Probe one URL with Node built-in fetch only: no rendering, no auth, no
 * crawling. Follows at most HTTP_PROBE_MAX_HOPS redirects manually.
 */
export async function probeOneUrl(
  startUrl: string,
  options: { fetchFn?: ProbeFetch; timeoutMs?: number; now?: () => Date } = {},
): Promise<{ ok: true; rawBytes: Buffer; raw: HttpProbeRaw }> {
  const fetchFn = (options.fetchFn ?? globalThis.fetch) as unknown as ProbeFetch;
  const timeoutMs = options.timeoutMs ?? HTTP_PROBE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const hops: HttpProbeHop[] = [];
  let current = startUrl;
  let failure: { status: null; title: null; error: HttpProbeErrorCode } | null = null;
  let final: { status: number; title: string | null; selected: HttpProbeRaw["selectedHeaders"]; error: HttpProbeErrorCode | null } | null = null;

  for (let hop = 0; hop <= HTTP_PROBE_MAX_HOPS; hop += 1) {
    let response: Awaited<ReturnType<ProbeFetch>>;
    try {
      response = await fetchFn(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      failure = {
        status: null,
        title: null,
        error: name === "TimeoutError" ? "timeout" : "fetch_failed",
      };
      break;
    }

    const entries = headerEntries(response.headers);
    const location = locationOf(entries);
    const next = redirectLocation(response.status, location);
    if (next !== null) {
      let resolved: string;
      try {
        resolved = new URL(next, current).toString();
      } catch {
        failure = { status: null, title: null, error: "invalid_redirect" };
        hops.push({ url: current, status: response.status, location });
        break;
      }
      if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) {
        failure = { status: null, title: null, error: "invalid_redirect" };
        hops.push({ url: current, status: response.status, location });
        break;
      }
      hops.push({ url: current, status: response.status, location });
      if (hops.length > HTTP_PROBE_MAX_HOPS) {
        failure = { status: null, title: null, error: "too_many_redirects" };
        break;
      }
      current = resolved;
      continue;
    }

    hops.push({ url: current, status: response.status, location });
    const selected = selectProbeHeaders(entries);
    const { text, tooLarge } = await readBoundedBodyText(response);
    final = {
      status: response.status,
      title: tooLarge ? null : parseProbeTitle(text),
      selected,
      error: tooLarge ? "body_too_large" : null,
    };
    break;
  }

  if (final === null && failure === null) {
    failure = { status: null, title: null, error: "too_many_redirects" };
  }

  const fetchedAt = now().toISOString();
  const candidate: HttpProbeRaw =
    final !== null
      ? {
          parserVersion: "http-probe-raw-v1",
          url: startUrl,
          fetchedAt,
          finalUrl: current,
          status: final.status,
          title: final.title,
          selectedHeaders: final.selected,
          hops,
          error: final.error,
        }
      : {
          parserVersion: "http-probe-raw-v1",
          url: startUrl,
          fetchedAt,
          finalUrl: current,
          status: null,
          title: null,
          selectedHeaders: { contentType: null, server: null, poweredBy: null },
          hops,
          error: (failure as { error: HttpProbeErrorCode }).error,
        };

  const built = buildProbeRawBytes(candidate);
  if (!built.ok) throw new Error(built.error);
  return { ok: true, rawBytes: Buffer.from(built.bytes), raw: candidate };
}
