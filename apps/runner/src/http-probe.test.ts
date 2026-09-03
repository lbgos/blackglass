import { describe, expect, it, vi } from "vitest";

import { probeOneUrl, probeUrlsFromSnapshot } from "./http-probe.js";

function response(status: number, headers: [string, string][] = [], body = "") {
  return {
    status,
    headers,
    arrayBuffer: async () => {
      const buf = Buffer.from(body, "utf8");
      const copy = new Uint8Array(buf.length);
      copy.set(buf);
      return copy.buffer as ArrayBuffer;
    },
  };
}

function snapshotFor(urls: string[]) {
  return {
    canonicalTargets: urls.map((url) => ({ kind: "url", url })),
  } as never;
}

describe("probeUrlsFromSnapshot", () => {
  it("accepts all-url snapshots", () => {
    expect(probeUrlsFromSnapshot(snapshotFor(["http://127.0.0.1:8080/"]))).toEqual([
      "http://127.0.0.1:8080/",
    ]);
  });

  it("rejects mixed snapshots", () => {
    expect(
      probeUrlsFromSnapshot({ canonicalTargets: [{ kind: "ip" }] } as never),
    ).toBe(null);
  });
});

describe("probeOneUrl", () => {
  it("records status, title, headers, and hops", async () => {
    const fetchFn = vi.fn(async () =>
      response(
        200,
        [["content-type", "text/html"], ["server", "lab"]],
        "<html><title>Lab Box</title></html>",
      ),
    );
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(raw.status).toBe(200);
    expect(raw.title).toBe("Lab Box");
    expect(raw.selectedHeaders).toEqual({
      contentType: "text/html",
      server: "lab",
      poweredBy: null,
    });
    expect(raw.hops).toEqual([
      { url: "http://127.0.0.1:8080/", status: 200, location: null },
    ]);
    expect(raw.error).toBe(null);
  });

  it("follows redirects up to the hop limit", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:8080/") {
        return response(302, [["location", "/next"]]);
      }
      return response(200, [], "<title>Final</title>");
    });
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(raw.finalUrl).toBe("http://127.0.0.1:8080/next");
    expect(raw.hops.length).toBe(2);
    expect(raw.title).toBe("Final");
  });

  it("records too_many_redirects without inventing a status", async () => {
    const fetchFn = vi.fn(async () =>
      response(301, [["location", "http://127.0.0.1:8080/loop"]]),
    );
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(raw.error).toBe("too_many_redirects");
    expect(raw.hops.length).toBeLessThanOrEqual(6);
  });

  it("records fetch failures with empty hops and null status", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(" refused");
    });
    const { raw } = await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(raw.error).toBe("fetch_failed");
    expect(raw.status).toBe(null);
    expect(raw.hops).toEqual([]);
  });

  it("uses only manual redirect mode", async () => {
    let seenInit: unknown;
    const fetchFn = async (_url: string, init?: { redirect?: RequestRedirect }) => {
      seenInit = init;
      return response(200, [], "");
    };
    await probeOneUrl("http://127.0.0.1:8080/", {
      fetchFn: fetchFn as never,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(seenInit).toMatchObject({ redirect: "manual" });
  });
});
