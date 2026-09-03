import { describe, expect, it } from "vitest";

import {
  isHttpProbeSnapshot,
  parseProbeTitle,
  probeUrlsForSnapshot,
  selectProbeHeaders,
} from "./http-probe.js";

function urlSnapshot(urls: string[]) {
  return {
    canonicalTargets: urls.map((url) => ({
      kind: "url" as const,
      normalizationProfile: "d1-v1" as const,
      url,
      origin: "http://127.0.0.1:80" as const,
      host: { hostname: "x" } as never,
      effectivePort: 80 as const,
      pathAndQuery: "/" as const,
    })),
  } as never;
}

describe("http probe snapshot detection", () => {
  it("accepts all-url snapshots and rejects mixed ones", () => {
    expect(
      isHttpProbeSnapshot(urlSnapshot(["http://127.0.0.1:8080/"])),
    ).toBe(true);
    expect(isHttpProbeSnapshot(urlSnapshot([]))).toBe(false);
    expect(
      probeUrlsForSnapshot(urlSnapshot(["http://127.0.0.1:8080/"])),
    ).toEqual(["http://127.0.0.1:8080/"]);
  });

  it("rejects duplicates", () => {
    expect(
      probeUrlsForSnapshot(
        urlSnapshot(["http://127.0.0.1:8080/", "http://127.0.0.1:8080/"]),
      ),
    ).toBe(null);
  });
});

describe("probe title and headers", () => {
  it("parses the first title and strips inner tags", () => {
    expect(parseProbeTitle("<html><title>  Lab <b>Box</b> </title></html>")).toBe(
      "Lab Box",
    );
    expect(parseProbeTitle("<html><body>none</body></html>")).toBe(null);
    expect(parseProbeTitle("<title></title>")).toBe(null);
  });

  it("selects only the allowlisted headers", () => {
    expect(
      selectProbeHeaders([
        ["Content-Type", "text/html"],
        ["Server", "lab"],
        ["X-Secret", "no"],
      ]),
    ).toEqual({ contentType: "text/html", server: "lab", poweredBy: null });
  });
});
