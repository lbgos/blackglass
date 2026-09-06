import { describe, expect, it } from "vitest";

import { partitionAdvisorCitations } from "./advisor-citations.js";

const supplied = [
  { kind: "artifact" as const, id: "nmap-xml-1" },
  { kind: "finding" as const, id: "20000000-0000-4000-8000-000000000001" },
  { kind: "service" as const, id: "192.0.2.10:80" },
];

describe("advisor citation partition", () => {
  it("marks supplied ids valid with their kinds and keeps order", () => {
    const result = partitionAdvisorCitations(supplied, [
      "192.0.2.10:80",
      "nmap-xml-1",
    ]);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toEqual([
      { raw: "192.0.2.10:80", valid: true, kind: "service" },
      { raw: "nmap-xml-1", valid: true, kind: "artifact" },
    ]);
  });

  it("marks unsupplied ids invalid for inert rendering", () => {
    const result = partitionAdvisorCitations(supplied, ["nmap-xml-1", "ghost-id"]);
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toEqual(["ghost-id"]);
  });

  it("dedupes repeats and matches case-sensitively", () => {
    const result = partitionAdvisorCitations(supplied, [
      "nmap-xml-1",
      "nmap-xml-1",
      "NMAP-XML-1",
    ]);
    expect(result.valid).toEqual([{ raw: "nmap-xml-1", valid: true, kind: "artifact" }]);
    expect(result.invalid).toEqual(["NMAP-XML-1"]);
  });

  it("handles empty supplied and cited sets", () => {
    expect(partitionAdvisorCitations([], [])).toEqual({ valid: [], invalid: [] });
    expect(partitionAdvisorCitations([], ["x"]).invalid).toEqual(["x"]);
  });
});
