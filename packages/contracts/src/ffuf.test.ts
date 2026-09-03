import { describe, expect, it } from "vitest";

import {
  FFUF_DEFAULT_MATCH_CODES,
  FfufActionOptionsSchema,
  FfufDiscoveryOutputSchema,
  FfufJsonResultSchema,
} from "./ffuf.js";

const validBase = {
  origin: "http://127.0.0.1:3130",
  wordlistPath: "/var/lib/blackglass/wordlists/smoke.txt",
  outputJsonPath: "/var/lib/blackglass/runs/run-1/ffuf.json",
} as const;

describe("FfufActionOptionsSchema", () => {
  it("applies defaults for rate, threads, timeouts, and match codes", () => {
    const parsed = FfufActionOptionsSchema.safeParse({ ...validBase });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        rate: 100,
        threads: 40,
        timeoutSeconds: 10,
        maxTimeSeconds: 120,
        matchStatusCodes: [...FFUF_DEFAULT_MATCH_CODES],
      });
    }
  });

  it("rejects non-http origin schemes", () => {
    for (const origin of ["ftp://127.0.0.1/", "file:///etc/passwd", "gopher://x/", "HTP://x/"]) {
      expect(FfufActionOptionsSchema.safeParse({ ...validBase, origin }).success).toBe(false);
    }
  });

  it("rejects overlong origins", () => {
    expect(
      FfufActionOptionsSchema.safeParse({ ...validBase, origin: `http://x/${"a".repeat(2048)}` }).success,
    ).toBe(false);
  });

  it("rejects relative and traversal wordlist/output paths", () => {
    expect(
      FfufActionOptionsSchema.safeParse({ ...validBase, wordlistPath: "relative/words.txt" }).success,
    ).toBe(false);
    expect(
      FfufActionOptionsSchema.safeParse({ ...validBase, wordlistPath: "/lists/../etc/passwd" }).success,
    ).toBe(false);
    expect(
      FfufActionOptionsSchema.safeParse({ ...validBase, outputJsonPath: "/runs/../etc/out.json" }).success,
    ).toBe(false);
    expect(
      FfufActionOptionsSchema.safeParse({ ...validBase, outputJsonPath: "/tmp/out\0.json" }).success,
    ).toBe(false);
  });

  it("rejects out-of-range numerics and bad status codes", () => {
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, rate: 0 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, rate: 10_001 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, threads: 0 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, threads: 201 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, timeoutSeconds: 0 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, timeoutSeconds: 121 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, maxTimeSeconds: 4 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, maxTimeSeconds: 1801 }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, matchStatusCodes: [] }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, matchStatusCodes: [99] }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, matchStatusCodes: [600] }).success).toBe(false);
    expect(FfufActionOptionsSchema.safeParse({ ...validBase, matchStatusCodes: [200.5] }).success).toBe(false);
  });

  it("rejects unknown fields (strict, no passthrough)", () => {
    expect(
      FfufActionOptionsSchema.safeParse({ ...validBase, rawFlags: ["-ac"] } as unknown as object).success,
    ).toBe(false);
    expect(
      FfufActionOptionsSchema.safeParse({ ...validBase, extensions: "php" } as unknown as object).success,
    ).toBe(false);
  });
});

describe("FfufJsonResultSchema", () => {
  it("accepts a record shaped like ffuf -of json output", () => {
    const parsed = FfufJsonResultSchema.safeParse({
      url: "http://127.0.0.1:3130/planted.txt",
      status: 200,
      length: 10,
      words: 1,
      lines: 2,
      input: { FUZZ: "planted.txt" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an optional redirectlocation", () => {
    const parsed = FfufJsonResultSchema.safeParse({
      url: "http://127.0.0.1:3130/old",
      status: 301,
      length: 0,
      words: 0,
      lines: 0,
      redirectlocation: "http://127.0.0.1:3130/new",
      input: { FUZZ: "old" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects missing input, bad status, and extra keys", () => {
    const base = {
      url: "http://127.0.0.1:3130/planted.txt",
      status: 200,
      length: 10,
      words: 1,
      lines: 2,
      input: { FUZZ: "planted.txt" },
    };
    expect(FfufJsonResultSchema.safeParse({ ...base, status: 99 }).success).toBe(false);
    expect(FfufJsonResultSchema.safeParse({ ...base, input: {} }).success).toBe(false);
    expect(FfufJsonResultSchema.safeParse({ ...base, position: 1 } as unknown as object).success).toBe(false);
  });
});

describe("FfufDiscoveryOutputSchema", () => {
  it("accepts empty results with truncated flag", () => {
    expect(FfufDiscoveryOutputSchema.safeParse({ results: [], truncated: false }).success).toBe(true);
  });

  it("rejects more than 100000 results", () => {
    const one = {
      url: "http://127.0.0.1:3130/a",
      status: 200,
      length: 1,
      words: 1,
      lines: 1,
      input: { FUZZ: "a" },
    };
    expect(
      FfufDiscoveryOutputSchema.safeParse({ results: Array.from({ length: 100_001 }, () => ({ ...one })), truncated: true })
        .success,
    ).toBe(false);
  });
});
