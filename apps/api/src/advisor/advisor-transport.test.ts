import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from "node:https";
import { readFileSync } from "node:fs";
import type { AddressInfo, Socket } from "node:net";
import type { TLSSocket } from "node:tls";

import { afterEach, describe, expect, it } from "vitest";

import {
  ADVISOR_TRANSPORT_RESPONSE_MAX_BYTES,
  defaultAdvisorTransportRequest,
  postAdvisorChatCompletion,
  type AdvisorTransportInput,
  type AdvisorTransportMessage,
  type AdvisorTransportRequestFn,
} from "./advisor-transport.js";

// Focused transport tests for CI. All servers are loopback-only with
// ephemeral ports; all DNS is injected. TLS fixtures under ./fixtures are
// synthetic test-only material with verification kept fully enabled: the
// mismatch case proves bad names reject, so no insecure flag exists anywhere.
// No real endpoints are contacted.

const fixtureUrl = new URL("./fixtures/", import.meta.url);
function readFixture(name: string): string {
  return readFileSync(new URL(name, fixtureUrl), "utf8");
}

interface LabBehavior {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
  /** Keep the socket open without responding (cancellation tests). */
  hang?: boolean;
  /** Send headers plus a partial body, then destroy the socket. */
  destroyMidBody?: boolean;
}

interface LabServer {
  hits: () => number;
  connections: () => number;
  openSockets: () => number;
  lastAuthorization: () => string | undefined;
  lastHostHeader: () => string | undefined;
  lastServername: () => string | undefined;
  port: () => number;
  behavior: LabBehavior;
}

const labServers: Array<HttpServer | HttpsServer> = [];

afterEach(async () => {
  const servers = labServers.splice(0);
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

function attachHandler(
  request: IncomingMessage,
  response: ServerResponse,
  state: {
    hits: number;
    authorization: string | undefined;
    hostHeader: string | undefined;
    servername: string | undefined;
  },
  behavior: LabBehavior,
): void {
  state.hits += 1;
  request.on("error", () => {});
  response.on("error", () => {});
  const authorization = request.headers.authorization;
  state.authorization = Array.isArray(authorization) ? authorization[0] : authorization;
  const hostHeader = request.headers.host;
  state.hostHeader = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const socket = request.socket as Partial<TLSSocket> & { servername?: unknown };
  state.servername = typeof socket.servername === "string" ? socket.servername : undefined;
  if (behavior.hang === true) return;
  if (behavior.destroyMidBody === true) {
    response.writeHead(behavior.status, behavior.headers ?? {});
    response.write((behavior.body ?? "").slice(0, 16));
    response.destroy();
    return;
  }
  const respond = (): void => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(behavior.status, behavior.headers ?? {});
    response.end(behavior.body ?? "");
  };
  if (behavior.delayMs !== undefined && behavior.delayMs > 0) {
    setTimeout(respond, behavior.delayMs).unref?.();
    return;
  }
  respond();
}

// TCP-level tracking shared by both lab servers: connections proves a client
// arrived, openSockets proves cleanup independent of afterEach teardown.
function trackLabConnections(server: HttpServer | HttpsServer): {
  connections: () => number;
  openSockets: () => number;
} {
  let connections = 0;
  const open = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    connections += 1;
    open.add(socket);
    socket.on("close", () => {
      open.delete(socket);
    });
  });
  return { connections: () => connections, openSockets: () => open.size };
}

async function startLabHttpServer(behavior: LabBehavior): Promise<LabServer> {
  const state = {
    hits: 0,
    authorization: undefined as string | undefined,
    hostHeader: undefined as string | undefined,
    servername: undefined as string | undefined,
  };
  const server = createHttpServer((request, response) => attachHandler(request, response, state, behavior));
  const tracked = trackLabConnections(server);
  labServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    hits: () => state.hits,
    connections: tracked.connections,
    openSockets: tracked.openSockets,
    lastAuthorization: () => state.authorization,
    lastHostHeader: () => state.hostHeader,
    lastServername: () => state.servername,
    port: () => port,
    behavior,
  };
}

async function startLabHttpsServer(behavior: LabBehavior): Promise<LabServer> {
  const state = {
    hits: 0,
    authorization: undefined as string | undefined,
    hostHeader: undefined as string | undefined,
    servername: undefined as string | undefined,
  };
  const server = createHttpsServer(
    {
      key: readFixture("synthetic-test-server-key.pem"),
      cert: readFixture("synthetic-test-server-cert.pem"),
    },
    (request, response) => attachHandler(request, response, state, behavior),
  );
  const tracked = trackLabConnections(server);
  labServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    hits: () => state.hits,
    connections: tracked.connections,
    openSockets: tracked.openSockets,
    lastAuthorization: () => state.authorization,
    lastHostHeader: () => state.hostHeader,
    lastServername: () => state.servername,
    port: () => port,
    behavior,
  };
}

function completionBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

interface BaseInputOverrides {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly messages?: readonly AdvisorTransportMessage[];
  readonly apiKey?: string | null;
  readonly publicOptIn?: boolean;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}

function baseInput(overrides: BaseInputOverrides = {}): AdvisorTransportInput {
  return {
    baseUrl: overrides.baseUrl ?? "http://localhost:1/v1",
    model: overrides.model ?? "synthetic-test-model",
    messages: overrides.messages ?? [{ role: "user", content: "Explain the banner." }],
    apiKey: overrides.apiKey ?? null,
    publicOptIn: overrides.publicOptIn ?? false,
    ...(overrides.maxTokens === undefined ? {} : { maxTokens: overrides.maxTokens }),
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
  };
}

function countingLookup(
  addresses: readonly string[] | Error,
): { fn: (hostname: string) => Promise<readonly string[]>; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    fn: async () => {
      calls += 1;
      if (addresses instanceof Error) throw addresses;
      return addresses;
    },
  };
}

const loopbackDns = (): ((hostname: string) => Promise<readonly string[]>) => {
  return async () => ["127.0.0.1"];
};

function withTestCa(): AdvisorTransportRequestFn {
  const caPem = readFixture("synthetic-test-ca.pem");
  return (options) => defaultAdvisorTransportRequest({ ...options, caPem });
}

describe("advisor transport input validation", () => {
  it("rejects malformed and non-http(s) base urls without network", async () => {
    for (const baseUrl of ["not a url", "", "ftp://localhost:1/", "file:///etc/passwd"]) {
      const dns = countingLookup(["127.0.0.1"]);
      const result = await postAdvisorChatCompletion(baseInput({ baseUrl }), {
        lookupAll: dns.fn,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_base_url");
      expect(dns.calls()).toBe(0);
    }
  });

  it("rejects credentials, query, and fragment with zero lookups", async () => {
    const cases = [
      "http://operator:synthetic@localhost:1/v1",
      "http://localhost:1/v1?key=synthetic",
      "http://localhost:1/v1#fragment",
    ] as const;
    const expected = [
      "url_credentials_rejected",
      "url_query_rejected",
      "url_fragment_rejected",
    ] as const;
    for (const [index, baseUrl] of cases.entries()) {
      const dns = countingLookup(["127.0.0.1"]);
      const result = await postAdvisorChatCompletion(baseInput({ baseUrl }), {
        lookupAll: dns.fn,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(expected[index]);
      expect(dns.calls()).toBe(0);
    }
  });

  it("rejects malformed messages, model, key, and budgets", async () => {
    const bad: BaseInputOverrides[] = [
      { messages: [] },
      { messages: Array.from({ length: 9 }, () => ({ role: "user" as const, content: "x" })) },
      { messages: [{ role: "tool" as never, content: "x" }] },
      { messages: [{ role: "user", content: "" }] },
      { messages: [{ role: "user", content: "x".repeat(33 * 1_024) }] },
      { model: "" },
      { model: "x".repeat(129) },
      { apiKey: "" },
      { maxTokens: 0 },
      { maxTokens: 4_097 },
      { timeoutMs: 10 },
    ];
    for (const override of bad) {
      const dns = countingLookup(["127.0.0.1"]);
      const result = await postAdvisorChatCompletion(baseInput(override), {
        lookupAll: dns.fn,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_input");
      expect(dns.calls()).toBe(0);
    }
  });

  it("rejects header-unsafe keys with zero dns", async () => {
    for (const apiKey of ["has space", "line\r\nbreak: x", "tab\there", "ünïcodé"]) {
      const dns = countingLookup(["127.0.0.1"]);
      const result = await postAdvisorChatCompletion(baseInput({ apiKey }), {
        lookupAll: dns.fn,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_input");
      expect(dns.calls()).toBe(0);
    }
  });
});

describe("advisor transport dns policy", () => {
  it("reports public endpoints without opt-in before any dns", async () => {
    const dns = countingLookup(["192.0.2.1"]);
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: "http://public-host.invalid:1/v1" }),
      { lookupAll: dns.fn },
    );
    expect(result).toEqual({ ok: false, error: { code: "public_not_opted_in" } });
    expect(dns.calls()).toBe(0);
  });

  it("rejects mixed and policy-violating answers with zero connections", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("ok"),
    });
    const privateMixed = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
      { lookupAll: countingLookup(["127.0.0.1", "192.0.2.1"]).fn },
    );
    expect(privateMixed).toEqual({ ok: false, error: { code: "dns_policy_violation" } });
    const publicMixed = await postAdvisorChatCompletion(
      baseInput({
        baseUrl: `http://public-host.invalid:${lab.port()}/v1`,
        publicOptIn: true,
      }),
      { lookupAll: countingLookup(["192.0.2.1", "10.9.9.9"]).fn },
    );
    expect(publicMixed).toEqual({ ok: false, error: { code: "dns_policy_violation" } });
    expect(lab.hits()).toBe(0);
  });

  it("reports unresolvable dns without connecting", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("ok"),
    });
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
      { lookupAll: countingLookup(new Error("synthetic dns failure")).fn },
    );
    expect(result).toEqual({ ok: false, error: { code: "dns_unresolvable" } });
    expect(lab.hits()).toBe(0);
  });

  it("rejects non-ip dns answers without requesting", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("ok"),
    });
    // A garbage answer classifies public, so unanimity alone would pass it
    // for a public host and send a hostname back to the socket layer.
    const result = await postAdvisorChatCompletion(
      baseInput({
        baseUrl: `http://public-host.invalid:${lab.port()}/v1`,
        publicOptIn: true,
      }),
      { lookupAll: countingLookup(["not-an-ip"]).fn },
    );
    expect(result).toEqual({ ok: false, error: { code: "dns_policy_violation" } });
    expect(lab.hits()).toBe(0);
  });

  it("times out a hanging resolver without connecting late", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("ok"),
    });
    let release!: (addresses: readonly string[]) => void;
    const gate = new Promise<readonly string[]>((resolve) => {
      release = resolve;
    });
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1`, timeoutMs: 200 }),
      { lookupAll: () => gate },
    );
    expect(result).toEqual({ ok: false, error: { code: "provider_timeout" } });
    release(["127.0.0.1"]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lab.hits()).toBe(0);
  });

  it("ignores a late resolver result after abort and never connects", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("ok"),
    });
    let release!: (addresses: readonly string[]) => void;
    const gate = new Promise<readonly string[]>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    const pending = postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
      { lookupAll: () => gate, signal: controller.signal },
    );
    controller.abort();
    const result = await pending;
    release(["127.0.0.1"]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result).toEqual({ ok: false, error: { code: "cancelled" } });
    expect(lab.hits()).toBe(0);
  });

  it("reports an already-aborted call without dns", async () => {
    const dns = countingLookup(["127.0.0.1"]);
    const controller = new AbortController();
    controller.abort();
    const result = await postAdvisorChatCompletion(baseInput(), {
      lookupAll: dns.fn,
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, error: { code: "cancelled" } });
    expect(dns.calls()).toBe(0);
  });
});

describe("advisor transport success paths", () => {
  it("posts once to the pinned ip with the original host header", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("Banner indicates HTTP."),
    });
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
      { lookupAll: loopbackDns() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.untrustedContent).toBe("Banner indicates HTTP.");
    expect(result.statusCode).toBe(200);
    expect(result.connectedAddress).toBe("127.0.0.1");
    expect(typeof result.latencyMs).toBe("number");
    expect(lab.hits()).toBe(1);
    expect(lab.lastHostHeader()).toBe(`localhost:${lab.port()}`);
    expect(lab.lastAuthorization()).toBeUndefined();
  });

  it("sends bearer auth only when a key is set", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("ok"),
    });
    const authed = await postAdvisorChatCompletion(
      baseInput({
        baseUrl: `http://localhost:${lab.port()}/v1`,
        apiKey: "synthetic-test-key-001",
      }),
      { lookupAll: loopbackDns() },
    );
    expect(authed.ok).toBe(true);
    expect(lab.lastAuthorization()).toBe("Bearer synthetic-test-key-001");
  });

  it("verifies tls against the test ca with the original servername", async () => {
    const lab = await startLabHttpsServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("TLS ok."),
    });
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `https://localhost:${lab.port()}/v1` }),
      { lookupAll: loopbackDns(), requestFn: withTestCa() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.untrustedContent).toBe("TLS ok.");
    expect(lab.hits()).toBe(1);
    expect(lab.lastServername()).toBe("localhost");
    expect(lab.lastHostHeader()).toBe(`localhost:${lab.port()}`);
  });

  it("rejects a wrong tls name with verification enabled", async () => {
    const lab = await startLabHttpsServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("must not arrive"),
    });
    // mismatch.localhost classifies private, so injected loopback DNS passes
    // policy and a real handshake is attempted against a cert lacking the
    // name: TCP arrives, HTTP is never served, verification rejects.
    const result = await postAdvisorChatCompletion(
      baseInput({
        baseUrl: `https://mismatch.localhost:${lab.port()}/v1`,
      }),
      { lookupAll: loopbackDns(), requestFn: withTestCa() },
    );
    expect(result).toEqual({ ok: false, error: { code: "tls_error" } });
    expect(lab.connections()).toBeGreaterThanOrEqual(1);
    expect(lab.hits()).toBe(0);
  });
});

describe("advisor transport budgets and failures", () => {
  it("times out a hanging endpoint within budget", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("late"),
      delayMs: 5_000,
    });
    const startedAt = Date.now();
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1`, timeoutMs: 200 }),
      { lookupAll: loopbackDns() },
    );
    expect(result).toEqual({ ok: false, error: { code: "provider_timeout" } });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("bounds the serialized request before any connection or dns", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("ok"),
    });
    const dns = countingLookup(["127.0.0.1"]);
    const result = await postAdvisorChatCompletion(
      baseInput({
        baseUrl: `http://localhost:${lab.port()}/v1`,
        messages: Array.from({ length: 3 }, (_, index) => ({
          role: "user" as const,
          content: `evidence-${index}:` + "x".repeat(25_600),
        })),
      }),
      { lookupAll: dns.fn },
    );
    expect(result).toEqual({ ok: false, error: { code: "request_too_large" } });
    expect(dns.calls()).toBe(0);
    expect(lab.hits()).toBe(0);
  });

  it("caps an oversized response body without retaining it", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("x".repeat(ADVISOR_TRANSPORT_RESPONSE_MAX_BYTES)),
    });
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
      { lookupAll: loopbackDns() },
    );
    expect(result).toEqual({ ok: false, error: { code: "response_too_large" } });
    expect(lab.hits()).toBe(1);
  });

  it("rejects redirects, streams, non-json, and bad statuses", async () => {
    const redirect = await startLabHttpServer({
      status: 302,
      headers: { location: "http://localhost:1/other" },
      body: "",
    });
    expect(
      await postAdvisorChatCompletion(
        baseInput({ baseUrl: `http://localhost:${redirect.port()}/v1` }),
        { lookupAll: loopbackDns() },
      ),
    ).toEqual({ ok: false, error: { code: "redirect_rejected" } });

    const stream = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: completionBody("ok"),
    });
    expect(
      await postAdvisorChatCompletion(
        baseInput({ baseUrl: `http://localhost:${stream.port()}/v1` }),
        { lookupAll: loopbackDns() },
      ),
    ).toEqual({ ok: false, error: { code: "invalid_content_type" } });

    const html = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: "<html>not json</html>",
    });
    expect(
      await postAdvisorChatCompletion(
        baseInput({ baseUrl: `http://localhost:${html.port()}/v1` }),
        { lookupAll: loopbackDns() },
      ),
    ).toEqual({ ok: false, error: { code: "malformed_response" } });

    const broken = await startLabHttpServer({ status: 500, body: "synthetic failure" });
    expect(
      await postAdvisorChatCompletion(
        baseInput({ baseUrl: `http://localhost:${broken.port()}/v1` }),
        { lookupAll: loopbackDns() },
      ),
    ).toEqual({ ok: false, error: { code: "unexpected_status", statusCode: 500 } });
  });

  it("reports provider errors without leaking key material", async () => {
    const lab = await startLabHttpServer({ status: 500, body: "synthetic failure" });
    const result = await postAdvisorChatCompletion(
      baseInput({
        baseUrl: `http://localhost:${lab.port()}/v1`,
        apiKey: "synthetic-test-key-001",
      }),
      { lookupAll: loopbackDns() },
    );
    expect(result).toEqual({ ok: false, error: { code: "unexpected_status", statusCode: 500 } });
    expect(JSON.stringify(result)).not.toContain("synthetic-test-key-001");
    expect(JSON.stringify(result)).not.toContain("synthetic failure");
  });

  it("rejects malformed completion shapes including tool-only output", async () => {
    const bodies = [
      "{}",
      '{"choices":[]}',
      '{"choices":[{"message":{"content":42}}]}',
      '{"choices":[{"message":{"tool_calls":[{"id":"call-1"}]}}]}',
    ];
    for (const body of bodies) {
      const lab = await startLabHttpServer({
        status: 200,
        headers: { "content-type": "application/json" },
        body,
      });
      const result = await postAdvisorChatCompletion(
        baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
        { lookupAll: loopbackDns() },
      );
      expect(result).toEqual({ ok: false, error: { code: "malformed_response" } });
    }
  });

  it("matches the json essence exactly while allowing parameters", async () => {
    const parametrized = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "Application/JSON; Charset=utf-8" },
      body: completionBody("ok"),
    });
    expect(
      await postAdvisorChatCompletion(
        baseInput({ baseUrl: `http://localhost:${parametrized.port()}/v1` }),
        { lookupAll: loopbackDns() },
      ),
    ).toMatchObject({ ok: true });

    for (const contentType of ["application/json-evil", "text/html; token=application/json"]) {
      const lab = await startLabHttpServer({
        status: 200,
        headers: { "content-type": contentType },
        body: completionBody("ok"),
      });
      expect(
        await postAdvisorChatCompletion(
          baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
          { lookupAll: loopbackDns() },
        ),
      ).toEqual({ ok: false, error: { code: "invalid_content_type" } });
    }
  });

  it("maps a synchronously throwing factory to connection_failed", async () => {
    const throwing: AdvisorTransportRequestFn = () => {
      throw new Error("synthetic sync boom");
    };
    const result = await postAdvisorChatCompletion(baseInput({ baseUrl: "http://127.0.0.1:1/v1" }), {
      requestFn: throwing,
    });
    expect(result).toEqual({ ok: false, error: { code: "connection_failed" } });
    expect(JSON.stringify(result)).not.toContain("synthetic sync boom");
  });

  it("bounds an injected factory that ignores abort and timeout", async () => {
    const hanging: AdvisorTransportRequestFn = () => new Promise(() => {});
    const controller = new AbortController();
    const pending = postAdvisorChatCompletion(baseInput({ baseUrl: "http://127.0.0.1:1/v1" }), {
      signal: controller.signal,
      requestFn: hanging,
    });
    controller.abort();
    const startedAt = Date.now();
    const result = await pending;
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result).toEqual({ ok: false, error: { code: "cancelled" } });
  });

  it("reports user cancellation for a stalled body", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      hang: true,
    });
    const controller = new AbortController();
    const pending = postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
      { lookupAll: loopbackDns(), signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { code: "cancelled" } });
    expect(lab.hits()).toBe(1);
    // The client socket must close promptly, not linger for afterEach teardown.
    const startedAt = Date.now();
    while (lab.openSockets() > 0 && Date.now() - startedAt < 2_000) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(lab.openSockets()).toBe(0);
  });

  it("reports a socket destroyed mid-body as a connection failure", async () => {
    const lab = await startLabHttpServer({
      status: 200,
      headers: { "content-type": "application/json" },
      body: completionBody("x".repeat(1_000)),
      destroyMidBody: true,
    });
    const result = await postAdvisorChatCompletion(
      baseInput({ baseUrl: `http://localhost:${lab.port()}/v1` }),
      { lookupAll: loopbackDns() },
    );
    expect(result).toEqual({ ok: false, error: { code: "connection_failed" } });
  });
});
