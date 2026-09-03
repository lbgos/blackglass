import { describe, expect, it } from "vitest";

import { HttpProbeRawSchema } from "./http-probe.js";

const validBase = {
  parserVersion: "http-probe-raw-v1" as const,
  url: "http://127.0.0.1:8080/",
  fetchedAt: "2026-09-03T00:00:00.000Z",
  finalUrl: "http://127.0.0.1:8080/",
  status: 200,
  title: "Lab",
  selectedHeaders: { contentType: "text/html", server: null, poweredBy: null },
  hops: [{ url: "http://127.0.0.1:8080/", status: 200, location: null }],
  error: null,
};

describe("HttpProbeRawSchema", () => {
  it("accepts a minimal probe result", () => {
    expect(HttpProbeRawSchema.safeParse(validBase).success).toBe(true);
  });

  it("rejects non-http schemes and hop overflow", () => {
    expect(
      HttpProbeRawSchema.safeParse({ ...validBase, url: "ftp://x/" }).success,
    ).toBe(false);
    const hops = Array.from({ length: 7 }, () => ({
      url: "http://127.0.0.1:8080/",
      status: 301,
      location: "http://127.0.0.1:8080/",
    }));
    expect(HttpProbeRawSchema.safeParse({ ...validBase, hops }).success).toBe(
      false,
    );
  });

  it("rejects overlong titles and allows empty hops on fetch failure", () => {
    expect(
      HttpProbeRawSchema.safeParse({ ...validBase, title: "x".repeat(257) })
        .success,
    ).toBe(false);
    expect(
      HttpProbeRawSchema.safeParse({
        ...validBase,
        status: null,
        hops: [],
        error: "fetch_failed",
      }).success,
    ).toBe(true);
  });
});
