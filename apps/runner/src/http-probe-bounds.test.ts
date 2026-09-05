import { describe, expect, it, vi } from "vitest";

import { HTTP_PROBE_MAX_BODY_BYTES } from "@blackglass/contracts";
import { probeOneUrl } from "./http-probe.js";

const MAX = HTTP_PROBE_MAX_BODY_BYTES;

function chunksStream(
  chunks: Uint8Array[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++] as Uint8Array);
      } else {
        controller.close();
      }
    },
    cancel() {
      onCancel?.();
    },
  });
}

function endlessStream(chunkSize = 8192, onPull?: () => void): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(chunkSize).fill(97);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.();
      controller.enqueue(chunk);
    },
    cancel() {},
  });
}

function streamingResponse(
  status: number,
  headers: [string, string][],
  body: ReadableStream<Uint8Array> | null,
  arrayBufferCalled: { value: boolean },
) {
  return {
    status,
    headers,
    body,
    arrayBuffer: async (): Promise<ArrayBuffer> => {
      arrayBufferCalled.value = true;
      throw new Error("must not call arrayBuffer when body stream present");
    },
  };
}

describe("http probe streaming bounds", () => {
  it("exact cap keeps body with null error", async () => {
    const called = { value: false };
    const bodyText = `a`.repeat(MAX - 30) + `<title>Exact</title>`;
    const bytes = Buffer.from(bodyText, "utf8");
    expect(bytes.length).toBeLessThanOrEqual(MAX);
    // Pad to exactly MAX bytes with ASCII so length is exact.
    const padded = Buffer.concat([bytes, Buffer.alloc(MAX - bytes.length, "b")]);
    expect(padded.length).toBe(MAX);
    const fetchFn = vi.fn(async () =>
      streamingResponse(200, [["content-type", "text/html"]], chunksStream([padded]), called),
    );
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(called.value).toBe(false);
    expect(raw.error).toBe(null);
    expect(raw.status).toBe(200);
    expect(raw.hops).toEqual([{ url: "http://127.0.0.1:8080/", status: 200, location: null }]);
  });

  it("cap+1 reports body_too_large with truncated text and truthful hops", async () => {
    const called = { value: false };
    const over = Buffer.alloc(MAX + 1, "a");
    const fetchFn = vi.fn(async () =>
      streamingResponse(200, [["content-type", "text/html"]], chunksStream([over]), called),
    );
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(called.value).toBe(false);
    expect(raw.error).toBe("body_too_large");
    expect(raw.status).toBe(200);
    expect(raw.title).toBe(null);
    expect(raw.hops).toEqual([{ url: "http://127.0.0.1:8080/", status: 200, location: null }]);
  });

  it("over cap across many small reads retains at most cap and cancels reader", async () => {
    const called = { value: false };
    let pulls = 0;
    const chunk = new Uint8Array(8192).fill(120);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < 20; i += 1) chunks.push(chunk);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn = vi.fn(async () => streamingResponse(200, [], body, called));
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(called.value).toBe(false);
    expect(raw.error).toBe("body_too_large");
    expect(raw.status).toBe(200);
    expect(cancelled).toBe(true);
    // 65536 / 8192 = 8 reads to reach cap, plus 1 over-cap read. Must stop early, not drain 20.
    expect(pulls).toBeLessThanOrEqual(10);
    void chunks;
  });

  it("endless body returns body_too_large promptly without arrayBuffer", async () => {
    const called = { value: false };
    let pulls = 0;
    const fetchFn = vi.fn(async () =>
      streamingResponse(200, [], endlessStream(8192, () => { pulls += 1; }), called),
    );
    const start = Date.now();
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      timeoutMs: 5000,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(called.value).toBe(false);
    expect(raw.error).toBe("body_too_large");
    expect(pulls).toBeLessThanOrEqual(12);
  });

  it("midstream rejection maps to fetch_failed without throwing publication error", async () => {
    const called = { value: false };
    let n = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        n += 1;
        if (n === 1) {
          controller.enqueue(new Uint8Array([65, 66, 67]));
          return;
        }
        controller.error(new Error("midstream boom"));
      },
      cancel() {},
    });
    const fetchFn = vi.fn(async () => streamingResponse(200, [], body, called));
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(called.value).toBe(false);
    expect(raw.error).toBe("fetch_failed");
    expect(raw.status).toBe(null);
    expect(raw.hops).toEqual([{ url: "http://127.0.0.1:8080/", status: 200, location: null }]);
  });

  it("distinguishes timeout from network failure", async () => {
    const timeoutFn = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const networkFn = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const t = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: timeoutFn as never,
      timeoutMs: 200,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    const n = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: networkFn as never,
      timeoutMs: 200,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(t.raw.error).toBe("timeout");
    expect(t.raw.status).toBe(null);
    expect(n.raw.error).toBe("fetch_failed");
    expect(n.raw.status).toBe(null);
  });
});

describe("http probe abort and disposal", () => {
  it("abort before request issues no fetch and throws abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn(async () => ({
      status: 200,
      headers: [] as [string, string][],
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    await expect(
      probeOneUrl("http://127.0.0.1:8080/", {
        fetchFn: fetchFn as never,
        signal: controller.signal,
        now: () => new Date("2026-09-03T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ name: expect.stringMatching(/Abort|probe_aborted/i) });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("abort during headers aborts promptly without waiting full timeout", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal | null }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const pending = probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      timeoutMs: 2000,
      signal: controller.signal,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    setTimeout(() => controller.abort(), 20);
    const start = Date.now();
    await expect(pending).rejects.toMatchObject({
      name: expect.stringMatching(/Abort|probe_aborted/i),
    });
    expect(Date.now() - start).toBeLessThan(800);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("abort during body cancels reader and throws abort", async () => {
    const controller = new AbortController();
    const called = { value: false };
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        // First chunk fast, second hangs until cancelled.
        if (!cancelled && (c as unknown as { __sent?: boolean }).__sent !== true) {
          (c as unknown as { __sent?: boolean }).__sent = true;
          c.enqueue(new Uint8Array(1024).fill(98));
          return;
        }
        await new Promise<never>(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn = vi.fn(async () => streamingResponse(200, [], body, called));
    const pending = probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      timeoutMs: 2000,
      signal: controller.signal,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({
      name: expect.stringMatching(/Abort|probe_aborted/i),
    });
    expect(cancelled).toBe(true);
  });

  it("no new request after cancellation across redirect", async () => {
    const controller = new AbortController();
    const called = { value: false };
    let secondCalled = false;
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:8080/") {
        controller.abort();
        return streamingResponse(302, [["location", "/next"]], chunksStream([]), called);
      }
      secondCalled = true;
      return streamingResponse(200, [], chunksStream([new Uint8Array([65])]), called);
    });
    await expect(
      probeOneUrl("http://127.0.0.1:8080/", {
        fetchFn: fetchFn as never,
        signal: controller.signal,
        now: () => new Date("2026-09-03T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ name: expect.stringMatching(/Abort|probe_aborted/i) });
    expect(secondCalled).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("redirect responses are disposed via body cancel", async () => {
    const called = { value: false };
    let redirectCancelled = false;
    const redirectBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([65]));
      },
      cancel() {
        redirectCancelled = true;
      },
    });
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:8080/") {
        return streamingResponse(302, [["location", "/next"]], redirectBody, called);
      }
      return streamingResponse(200, [], chunksStream([Buffer.from("<title>Final</title>")]), called);
    });
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(raw.finalUrl).toBe("http://127.0.0.1:8080/next");
    expect(redirectCancelled).toBe(true);
    expect(called.value).toBe(false);
  });

  it("hanging redirect disposal cannot hang past deadline", async () => {
    const called = { value: false };
    const hangingBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([65]));
      },
      cancel() {
        return new Promise<void>(() => {});
      },
    });
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:8080/") {
        return streamingResponse(302, [["location", "/next"]], hangingBody, called);
      }
      return streamingResponse(200, [], chunksStream([Buffer.from("<title>Final</title>")]), called);
    });
    const start = Date.now();
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      timeoutMs: 150,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(Date.now() - start).toBeLessThan(1500);
    expect(raw.finalUrl).toBe("http://127.0.0.1:8080/next");
  });
});
