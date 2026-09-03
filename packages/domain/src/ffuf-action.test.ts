import { describe, expect, it } from "vitest";

import { ffufOptionsForSnapshot, hasFfufMarker, isFfufSnapshot } from "./ffuf-action.js";
import { parseFfufArtifactJson } from "./ffuf-json.js";

const ffufOptions = {
  origin: "http://127.0.0.1:3130",
  wordlistPath: "/lists/smoke.txt",
  rate: 100,
  threads: 40,
  timeoutSeconds: 10,
  maxTimeSeconds: 120,
  matchStatusCodes: [200, 403],
};

function urlTarget(url: string) {
  return {
    kind: "url" as const,
    normalizationProfile: "d1-v1" as const,
    url,
    origin: "http://127.0.0.1:3130" as const,
    host: { hostname: "x" } as never,
    effectivePort: 3130 as const,
    pathAndQuery: "/" as const,
  };
}

function snapshot(targets: unknown[], typedOptions: unknown) {
  return { canonicalTargets: targets, typedOptions } as never;
}

describe("ffuf snapshot detection", () => {
  it("accepts a single URL origin with validated ffuf options", () => {
    const candidate = snapshot([urlTarget("http://127.0.0.1:3130/")], {
      declaredPorts: null,
      ffuf: ffufOptions,
    });
    expect(isFfufSnapshot(candidate)).toBe(true);
    expect(ffufOptionsForSnapshot(candidate)).toEqual(ffufOptions);
  });

  it("rejects plain URL snapshots, multi-target snapshots, and bad options", () => {
    expect(
      isFfufSnapshot(snapshot([urlTarget("http://127.0.0.1:3130/")], { declaredPorts: null })),
    ).toBe(false);
    expect(
      isFfufSnapshot(
        snapshot([urlTarget("http://127.0.0.1:3130/"), urlTarget("http://127.0.0.1:3131/")], {
          declaredPorts: null,
          ffuf: ffufOptions,
        }),
      ),
    ).toBe(false);
    expect(
      isFfufSnapshot(
        snapshot([{ kind: "ip", address: "192.0.2.1" }], { declaredPorts: null, ffuf: ffufOptions }),
      ),
    ).toBe(false);
    expect(
      isFfufSnapshot(
        snapshot([urlTarget("http://127.0.0.1:3130/")], {
          declaredPorts: null,
          ffuf: { ...ffufOptions, origin: "ftp://x/" },
        }),
      ),
    ).toBe(false);
    expect(ffufOptionsForSnapshot(snapshot([], { declaredPorts: null }))).toBe(null);
  });

  it("flags corrupt ffuf markers fail-closed", () => {
    const corrupt = snapshot([urlTarget("http://127.0.0.1:3130/")], {
      declaredPorts: null,
      ffuf: { origin: "ftp://x/" },
    });
    expect(hasFfufMarker(corrupt)).toBe(true);
    expect(isFfufSnapshot(corrupt)).toBe(false);
    expect(
      hasFfufMarker(snapshot([urlTarget("http://127.0.0.1:3130/")], { declaredPorts: null })),
    ).toBe(false);
  });
});

describe("ffuf artifact projection", () => {
  const planted = {
    input: { FUZZ: "planted.txt" },
    position: 1,
    status: 200,
    length: 10,
    words: 1,
    lines: 2,
    redirectlocation: "",
    resultfile: "",
    url: "http://127.0.0.1:3130/planted.txt",
    host: "127.0.0.1:3130",
  };

  it("projects raw records and normalizes empty redirectlocation", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ results: [planted] }));
    const result = parseFfufArtifactJson(bytes);
    expect(result).toEqual({
      ok: true,
      output: {
        results: [
          {
            url: "http://127.0.0.1:3130/planted.txt",
            status: 200,
            length: 10,
            words: 1,
            lines: 2,
            input: { FUZZ: "planted.txt" },
          },
        ],
        truncated: false,
      },
      rawCount: 1,
    });
  });

  it("rejects invalid JSON, non-array results, and bad records", () => {
    for (const bad of ["not json", "", '{"results": "nope"}', '{"nope": true}']) {
      expect(parseFfufArtifactJson(new TextEncoder().encode(bad)).ok).toBe(false);
    }
    const badRecord = new TextEncoder().encode(
      JSON.stringify({ results: [{ ...planted, status: 99 }] }),
    );
    expect(parseFfufArtifactJson(badRecord)).toEqual({
      ok: false,
      error: { code: "ffuf_parse_error" },
    });
  });
});
