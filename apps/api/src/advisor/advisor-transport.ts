import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ClientRequest, IncomingMessage } from "node:http";

import { classifyAdvisorEndpointHost } from "../advisor-status-probe.js";

/**
 * Isolated model transport for the read-only evidence explanation slice.
 * Exactly one non-streamed OpenAI-compatible POST per call: no retries, no
 * redirects, no fallback hosts, no keep-alive reuse, no proxy handling (raw
 * node:http(s) never consults proxy env). DNS resolves once through an
 * injectable lookup; the connection goes to the pinned IP while preserving
 * the original Host header and TLS servername, closing the probe's
 * lookup-then-fetch rebinding gap. Raw node:http(s) is used instead of fetch
 * so per-request agents, manual redirect handling, incremental byte caps,
 * and socket teardown are explicit.
 *
 * The transport never reads configuration or secrets: the caller (a future
 * route slice) passes an already-resolved key or null. Errors carry codes
 * plus small numeric metadata only, never bodies, URLs, or key material.
 * Success content is untrusted model bytes: later redaction and citation
 * validation are required before storage or UI. This module executes no
 * tools or actions.
 */

export const ADVISOR_TRANSPORT_TIMEOUT_MS = 75_000 as const;
export const ADVISOR_TRANSPORT_RESPONSE_MAX_BYTES = 32 * 1_024 as const;
export const ADVISOR_TRANSPORT_REQUEST_MAX_BYTES = 64 * 1_024 as const;
export const ADVISOR_TRANSPORT_MESSAGES_MAX = 8 as const;
export const ADVISOR_TRANSPORT_MESSAGE_MAX_BYTES = 32 * 1_024 as const;
export const ADVISOR_TRANSPORT_MODEL_MAX_CHARS = 128 as const;
export const ADVISOR_TRANSPORT_MAX_TOKENS_DEFAULT = 1_024 as const;
export const ADVISOR_TRANSPORT_MAX_TOKENS_MAX = 4_096 as const;
export const ADVISOR_TRANSPORT_TIMEOUT_MIN_MS = 100 as const;

export type AdvisorTransportErrorCode =
  | "invalid_input"
  | "invalid_base_url"
  | "url_credentials_rejected"
  | "url_query_rejected"
  | "url_fragment_rejected"
  | "request_too_large"
  | "public_not_opted_in"
  | "dns_unresolvable"
  | "dns_policy_violation"
  | "connection_failed"
  | "tls_error"
  | "redirect_rejected"
  | "unexpected_status"
  | "invalid_content_type"
  | "response_too_large"
  | "malformed_response"
  | "provider_timeout"
  | "cancelled";

export interface AdvisorTransportMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface AdvisorTransportInput {
  /** Explicit validated bounded messages from the P1 prompt builder. */
  readonly messages: readonly AdvisorTransportMessage[];
  readonly baseUrl: string;
  readonly model: string;
  /** Already-resolved key material or null; never an env var name. */
  readonly apiKey: string | null;
  readonly publicOptIn: boolean;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}

export interface AdvisorTransportSuccess {
  readonly ok: true;
  /**
   * Raw model bytes. Untrusted and internal-only: redact and validate
   * citations before storage or UI.
   */
  readonly untrustedContent: string;
  readonly statusCode: 200;
  readonly connectedAddress: string;
  readonly latencyMs: number;
}

export interface AdvisorTransportFailure {
  readonly ok: false;
  readonly error: {
    readonly code: AdvisorTransportErrorCode;
    /** Present only for unexpected_status. Numeric metadata, never a body. */
    readonly statusCode?: number;
  };
}

export type AdvisorTransportResult = AdvisorTransportSuccess | AdvisorTransportFailure;

export interface AdvisorTransportDeps {
  readonly signal?: AbortSignal;
  readonly lookupAll?: (hostname: string) => Promise<readonly string[]>;
  readonly requestFn?: AdvisorTransportRequestFn;
  readonly now?: () => number;
}

export interface AdvisorTransportRequestOptions {
  readonly secure: boolean;
  /** Pinned IP literal chosen from validated DNS results. */
  readonly address: string;
  readonly port: number;
  readonly path: string;
  /** Original hostname for TLS verification. */
  readonly servername: string;
  /** Original host header, brackets and non-default port preserved. */
  readonly hostHeader: string;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  /**
   * Test-only trust anchor. Certificate verification stays fully enabled;
   * there is deliberately no flag that disables it.
   */
  readonly caPem?: string;
}

export interface AdvisorTransportRawResponse {
  readonly statusCode: number;
  readonly contentType: string | null;
  readonly body: Buffer;
}

export type AdvisorTransportRequestFn = (
  options: AdvisorTransportRequestOptions,
) => Promise<AdvisorTransportRawResponse>;

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

interface ValidatedEndpoint {
  readonly secure: boolean;
  readonly hostname: string;
  readonly hostHeader: string;
  readonly port: number;
  readonly path: string;
}

type InputError =
  | "invalid_input"
  | "invalid_base_url"
  | "url_credentials_rejected"
  | "url_query_rejected"
  | "url_fragment_rejected";

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function validateEndpoint(baseUrl: string):
  | { ok: true; endpoint: ValidatedEndpoint }
  | { ok: false; error: InputError } {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, error: "invalid_base_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "invalid_base_url" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, error: "url_credentials_rejected" };
  }
  if (url.search !== "") return { ok: false, error: "url_query_rejected" };
  if (url.hash !== "") return { ok: false, error: "url_fragment_rejected" };
  const secure = url.protocol === "https:";
  const hostname = stripIpv6Brackets(url.hostname);
  if (hostname === "") return { ok: false, error: "invalid_base_url" };
  const defaultPort = secure ? 443 : 80;
  const port = url.port === "" ? defaultPort : Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return { ok: false, error: "invalid_base_url" };
  }
  const hostHeader = port === defaultPort ? url.hostname : `${url.hostname}:${port}`;
  const basePath = url.pathname.replace(/\/+$/, "");
  return {
    ok: true,
    endpoint: { secure, hostname, hostHeader, port, path: `${basePath}/chat/completions` },
  };
}

interface ValidatedInput {
  readonly endpoint: ValidatedEndpoint;
  readonly model: string;
  readonly messages: readonly AdvisorTransportMessage[];
  readonly apiKey: string | null;
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

function validateTransportInput(input: AdvisorTransportInput):
  | { ok: true; value: ValidatedInput }
  | { ok: false; error: InputError } {
  const endpoint = validateEndpoint(input.baseUrl);
  if (!endpoint.ok) return endpoint;
  if (typeof input.model !== "string" || input.model.trim() !== input.model) {
    return { ok: false, error: "invalid_input" };
  }
  if (input.model.length < 1 || input.model.length > ADVISOR_TRANSPORT_MODEL_MAX_CHARS) {
    return { ok: false, error: "invalid_input" };
  }
  if (!Array.isArray(input.messages) || input.messages.length < 1 ||
      input.messages.length > ADVISOR_TRANSPORT_MESSAGES_MAX) {
    return { ok: false, error: "invalid_input" };
  }
  for (const message of input.messages) {
    if (typeof message !== "object" || message === null) {
      return { ok: false, error: "invalid_input" };
    }
    if (message.role !== "system" && message.role !== "user") {
      return { ok: false, error: "invalid_input" };
    }
    if (typeof message.content !== "string" || message.content.length < 1 ||
        utf8ByteLength(message.content) > ADVISOR_TRANSPORT_MESSAGE_MAX_BYTES) {
      return { ok: false, error: "invalid_input" };
    }
  }
  if (input.apiKey !== null &&
      (typeof input.apiKey !== "string" || input.apiKey.length < 1 ||
       input.apiKey.length > 4_096)) {
    return { ok: false, error: "invalid_input" };
  }
  const maxTokens = input.maxTokens ?? ADVISOR_TRANSPORT_MAX_TOKENS_DEFAULT;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 ||
      maxTokens > ADVISOR_TRANSPORT_MAX_TOKENS_MAX) {
    return { ok: false, error: "invalid_input" };
  }
  const timeoutMs = input.timeoutMs ?? ADVISOR_TRANSPORT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < ADVISOR_TRANSPORT_TIMEOUT_MIN_MS ||
      timeoutMs > ADVISOR_TRANSPORT_TIMEOUT_MS) {
    return { ok: false, error: "invalid_input" };
  }
  return {
    ok: true,
    value: {
      endpoint: endpoint.endpoint,
      model: input.model,
      messages: input.messages,
      apiKey: input.apiKey,
      maxTokens,
      timeoutMs,
    },
  };
}

async function defaultLookupAll(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

interface Deadline {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
}

// One wall-clock budget with an unref'd timer so idle transports never hold
// the process open. Cancelled on every terminal path.
function createDeadline(timeoutMs: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

type DeadlineOutcome<T> =
  | { settled: "work"; value: T }
  | { settled: "cancelled" }
  | { settled: "timeout" };

// Race one unit of work against caller abort and the shared deadline. The
// losing side is ignored: in particular a DNS lookup that settles after
// abort or expiry never starts a connection.
function raceWithDeadline<T>(
  work: Promise<T>,
  signals: { caller: AbortSignal | undefined; timeout: AbortSignal },
): Promise<DeadlineOutcome<T>> {
  if (signals.caller?.aborted) return Promise.resolve({ settled: "cancelled" });
  if (signals.timeout.aborted) return Promise.resolve({ settled: "timeout" });
  return new Promise<DeadlineOutcome<T>>((resolve) => {
    let done = false;
    const cleanup = (): void => {
      signals.caller?.removeEventListener("abort", onCallerAbort);
      signals.timeout.removeEventListener("abort", onTimeout);
    };
    const onCallerAbort = (): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ settled: "cancelled" });
    };
    const onTimeout = (): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ settled: "timeout" });
    };
    signals.caller?.addEventListener("abort", onCallerAbort, { once: true });
    signals.timeout.addEventListener("abort", onTimeout, { once: true });
    work.then(
      (value) => {
        if (done) return;
        done = true;
        cleanup();
        resolve({ settled: "work", value });
      },
      () => {
        if (done) return;
        done = true;
        cleanup();
        resolve({ settled: "timeout" });
      },
    );
  });
}

class TransportRequestError extends Error {
  readonly code:
    | "cancelled"
    | "provider_timeout"
    | "connection_failed"
    | "tls_error"
    | "response_too_large";

  constructor(code: TransportRequestError["code"]) {
    super(code);
    this.name = "TransportRequestError";
    this.code = code;
  }
}

function isTlsErrorCode(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return (
    code.startsWith("CERT_") ||
    code.startsWith("ERR_TLS_") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "UNABLE_TO_GET_ISSUER_CERT" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN"
  );
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

// Default byte-moving request. Verification is always enabled; caPem only
// adds a trust anchor for loopback tests. Sockets are never pooled.
export function defaultAdvisorTransportRequest(
  options: AdvisorTransportRequestOptions,
): Promise<AdvisorTransportRawResponse> {
  return new Promise<AdvisorTransportRawResponse>((resolve, reject) => {
    const deadline = createDeadline(options.timeoutMs);
    const combined =
      options.signal === undefined
        ? deadline.signal
        : AbortSignal.any([options.signal, deadline.signal]);
    let settled = false;
    const settleFailure = (code: TransportRequestError["code"]): void => {
      if (settled) return;
      settled = true;
      deadline.cancel();
      reject(new TransportRequestError(code));
    };
    // Caller abort wins over expiry when both fired.
    const settleAborted = (): void => {
      settleFailure(options.signal?.aborted === true ? "cancelled" : "provider_timeout");
    };
    const headers = { ...options.headers, host: options.hostHeader, connection: "close" };
    let request: ClientRequest;
    try {
      request = options.secure
        ? httpsRequest({
            host: options.address,
            port: options.port,
            path: options.path,
            method: "POST",
            headers,
            agent: false,
            signal: combined,
            servername: options.servername,
            rejectUnauthorized: true,
            ...(options.caPem === undefined ? {} : { ca: options.caPem }),
          })
        : httpRequest({
            host: options.address,
            port: options.port,
            path: options.path,
            method: "POST",
            headers,
            agent: false,
            signal: combined,
          });
    } catch {
      settleFailure("connection_failed");
      return;
    }
    request.on("error", (error: unknown) => {
      if (settled) return;
      if (combined.aborted) {
        settleAborted();
        return;
      }
      settleFailure(isTlsErrorCode(error) ? "tls_error" : "connection_failed");
    });
    request.on("response", (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const abortBody = (code: TransportRequestError["code"]): void => {
        chunks.length = 0;
        settleFailure(code);
        response.destroy();
        request.destroy();
      };
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > ADVISOR_TRANSPORT_RESPONSE_MAX_BYTES) {
          abortBody("response_too_large");
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        deadline.cancel();
        resolve({
          statusCode: response.statusCode ?? 0,
          contentType: firstHeaderValue(response.headers["content-type"]),
          body: Buffer.concat(chunks, total),
        });
      });
      const onBodyError = (): void => {
        if (settled) return;
        if (combined.aborted) settleAborted();
        else settleFailure("connection_failed");
      };
      response.on("error", onBodyError);
      response.on("close", () => {
        if (!settled) onBodyError();
      });
    });
    try {
      request.end(options.body);
    } catch {
      settleFailure("connection_failed");
    }
  });
}

function extractCompletionContent(parsed: unknown): string | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : undefined;
}

export async function postAdvisorChatCompletion(
  input: AdvisorTransportInput,
  deps: AdvisorTransportDeps = {},
): Promise<AdvisorTransportResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const validated = validateTransportInput(input);
  if (!validated.ok) return { ok: false, error: { code: validated.error } };
  const { endpoint, model, messages, apiKey, maxTokens, timeoutMs } = validated.value;
  const caller = deps.signal;
  if (caller?.aborted) return { ok: false, error: { code: "cancelled" } };
  const deadline = createDeadline(timeoutMs);
  const timeout = deadline.signal;
  const remainingMs = (): number => timeoutMs - (now() - startedAt);
  try {
    return await runWithDeadline();
  } finally {
    deadline.cancel();
  }

  async function runWithDeadline(): Promise<AdvisorTransportResult> {
  // Pre-DNS policy gate: no network has happened yet.
  const hostVisibility = classifyAdvisorEndpointHost(endpoint.hostname);
  if (hostVisibility === "public" && !input.publicOptIn) {
    return { ok: false, error: { code: "public_not_opted_in" } };
  }

  const lookupAll = deps.lookupAll ?? defaultLookupAll;
  let addresses: readonly string[];
  if (isIP(endpoint.hostname) !== 0) {
    addresses = [endpoint.hostname];
  } else {
    let resolved: readonly string[] | undefined;
    try {
      const outcome = await raceWithDeadline(
        (async () => {
          try {
            const found = await lookupAll(endpoint.hostname);
            return found.length === 0 ? undefined : found;
          } catch {
            return undefined;
          }
        })(),
        { caller, timeout },
      );
      if (outcome.settled === "cancelled") return { ok: false, error: { code: "cancelled" } };
      if (outcome.settled === "timeout") return { ok: false, error: { code: "provider_timeout" } };
      resolved = outcome.value;
    } catch {
      return { ok: false, error: { code: "dns_unresolvable" } };
    }
    if (resolved === undefined) return { ok: false, error: { code: "dns_unresolvable" } };
    addresses = resolved;
  }

  // Every resolved address must agree with the hostname classification.
  // Mixed answers and public-to-private resolutions fail closed.
  const unanimous = addresses.every(
    (address) => classifyAdvisorEndpointHost(address) === hostVisibility,
  );
  if (!unanimous) return { ok: false, error: { code: "dns_policy_violation" } };
  const target = addresses[0];
  if (target === undefined) return { ok: false, error: { code: "dns_unresolvable" } };

  const body = Buffer.from(
    JSON.stringify({
      model,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      temperature: 0,
      stream: false,
    }),
    "utf8",
  );
  if (body.length > ADVISOR_TRANSPORT_REQUEST_MAX_BYTES) {
    return { ok: false, error: { code: "request_too_large" } };
  }

  if (caller?.aborted) return { ok: false, error: { code: "cancelled" } };
  const budgetMs = remainingMs();
  if (budgetMs <= 0 || timeout.aborted) return { ok: false, error: { code: "provider_timeout" } };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "content-length": String(body.length),
  };
  if (apiKey !== null) headers.authorization = `Bearer ${apiKey}`;
  const requestFn = deps.requestFn ?? defaultAdvisorTransportRequest;
  let raw: AdvisorTransportRawResponse;
  try {
    raw = await requestFn({
      secure: endpoint.secure,
      address: target,
      port: endpoint.port,
      path: endpoint.path,
      servername: endpoint.hostname,
      hostHeader: endpoint.hostHeader,
      headers,
      body,
      timeoutMs: budgetMs,
      signal: caller,
    });
  } catch (error) {
    if (error instanceof TransportRequestError) {
      if (error.code === "cancelled") return { ok: false, error: { code: "cancelled" } };
      if (error.code === "provider_timeout") {
        return { ok: false, error: { code: "provider_timeout" } };
      }
      if (error.code === "connection_failed") {
        return { ok: false, error: { code: "connection_failed" } };
      }
      if (error.code === "tls_error") return { ok: false, error: { code: "tls_error" } };
      return { ok: false, error: { code: "response_too_large" } };
    }
    return { ok: false, error: { code: "connection_failed" } };
  }

  if (raw.statusCode >= 300 && raw.statusCode <= 399) {
    return { ok: false, error: { code: "redirect_rejected" } };
  }
  if (raw.statusCode !== 200) {
    return { ok: false, error: { code: "unexpected_status", statusCode: raw.statusCode } };
  }
  const contentType = raw.contentType ?? "";
  if (
    !contentType.toLowerCase().includes("application/json") ||
    contentType.toLowerCase().includes("event-stream")
  ) {
    return { ok: false, error: { code: "invalid_content_type" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.body.toString("utf8"));
  } catch {
    return { ok: false, error: { code: "malformed_response" } };
  }
  const untrustedContent = extractCompletionContent(parsed);
  if (untrustedContent === undefined) return { ok: false, error: { code: "malformed_response" } };
  return {
    ok: true,
    untrustedContent,
    statusCode: 200,
    connectedAddress: target,
    latencyMs: Math.max(0, now() - startedAt),
  };
  }
}
