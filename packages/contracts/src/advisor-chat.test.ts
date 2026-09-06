import { describe, expect, it } from "vitest";

import {
  ADVISOR_CITATIONS_MAX,
  ADVISOR_EVIDENCE_BLOCKS_MAX,
  ADVISOR_EXCERPT_IDS_MAX,
  ADVISOR_FINDING_IDS_MAX,
  AdvisorEvidenceBlockListSchema,
  AdvisorEvidenceBlockSchema,
  AdvisorExplanationSchema,
  AdvisorPartitionedCitationSchema,
  CreateAdvisorExplanationRequestSchema,
} from "./advisor-chat.js";

const engagementId = "10000000-0000-4000-8000-000000000001";
const findingId = "20000000-0000-4000-8000-000000000001";

function validRequest() {
  return {
    engagementId,
    question: "What does this service banner indicate?",
    excerptArtifactIds: ["nmap-xml-1"],
  };
}

function validExplanation() {
  return {
    profile: "advisor-explanation-v1",
    answer: "The banner indicates an HTTP service on port 80.",
    citations: ["nmap-xml-1"],
    abstained: false,
    uncertainty: "",
  };
}

describe("advisor explanation request", () => {
  it("accepts a minimal request and defaults finding ids", () => {
    expect(CreateAdvisorExplanationRequestSchema.parse(validRequest())).toEqual({
      ...validRequest(),
      findingIds: [],
    });
  });

  it("rejects blank, padded, oversized, or missing questions", () => {
    for (const question of ["", "   ", " padded", "padded "]) {
      expect(
        CreateAdvisorExplanationRequestSchema.safeParse({
          ...validRequest(),
          question,
        }).success,
      ).toBe(false);
    }
    expect(
      CreateAdvisorExplanationRequestSchema.safeParse({
        ...validRequest(),
        question: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("bounds excerpt and finding selection", () => {
    expect(
      CreateAdvisorExplanationRequestSchema.safeParse({
        ...validRequest(),
        excerptArtifactIds: [],
      }).success,
    ).toBe(false);
    expect(
      CreateAdvisorExplanationRequestSchema.safeParse({
        ...validRequest(),
        excerptArtifactIds: Array.from(
          { length: ADVISOR_EXCERPT_IDS_MAX + 1 },
          (_, index) => `a-${index}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      CreateAdvisorExplanationRequestSchema.safeParse({
        ...validRequest(),
        excerptArtifactIds: ["a-1", "a-1"],
      }).success,
    ).toBe(false);
    expect(
      CreateAdvisorExplanationRequestSchema.safeParse({
        ...validRequest(),
        excerptArtifactIds: ["HAS-UPPER"],
      }).success,
    ).toBe(false);
    expect(
      CreateAdvisorExplanationRequestSchema.safeParse({
        ...validRequest(),
        findingIds: Array.from({ length: ADVISOR_FINDING_IDS_MAX + 1 }, () => findingId),
      }).success,
    ).toBe(false);
    expect(
      CreateAdvisorExplanationRequestSchema.safeParse({
        ...validRequest(),
        engagementId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("advisor explanation output", () => {
  it("accepts a grounded answer and an abstention with uncertainty", () => {
    expect(AdvisorExplanationSchema.parse(validExplanation())).toMatchObject({
      abstained: false,
    });
    expect(
      AdvisorExplanationSchema.parse({
        profile: "advisor-explanation-v1",
        answer: "",
        citations: [],
        abstained: true,
        uncertainty: "Excerpts do not show the service version.",
      }).abstained,
    ).toBe(true);
  });

  it("rejects blank answers, blank abstention uncertainty, and bad citations", () => {
    expect(
      AdvisorExplanationSchema.safeParse({ ...validExplanation(), answer: "  " }).success,
    ).toBe(false);
    expect(
      AdvisorExplanationSchema.safeParse({
        ...validExplanation(),
        abstained: true,
        answer: "",
        uncertainty: "",
      }).success,
    ).toBe(false);
    expect(
      AdvisorExplanationSchema.safeParse({
        ...validExplanation(),
        citations: ["nmap-xml-1", "nmap-xml-1"],
      }).success,
    ).toBe(false);
    expect(
      AdvisorExplanationSchema.safeParse({
        ...validExplanation(),
        citations: Array.from({ length: ADVISOR_CITATIONS_MAX + 1 }, (_, index) => `id-${index}`),
      }).success,
    ).toBe(false);
    expect(
      AdvisorExplanationSchema.safeParse({
        ...validExplanation(),
        citations: ["x".repeat(129)],
      }).success,
    ).toBe(false);
    expect(
      AdvisorExplanationSchema.safeParse({ ...validExplanation(), profile: "other" }).success,
    ).toBe(false);
  });
});

describe("advisor evidence blocks and partitioned citations", () => {
  it("bounds block text and block count", () => {
    expect(
      AdvisorEvidenceBlockSchema.safeParse({
        kind: "artifact",
        id: "nmap-xml-1",
        text: "x".repeat(8193),
      }).success,
    ).toBe(false);
    expect(
      AdvisorEvidenceBlockListSchema.safeParse(
        Array.from({ length: ADVISOR_EVIDENCE_BLOCKS_MAX + 1 }, (_, index) => ({
          kind: "artifact",
          id: `artifact-${index}`,
          text: "evidence",
        })),
      ).success,
    ).toBe(false);
  });

  it("keeps partitioned citations consistent: unknown means invalid", () => {
    expect(
      AdvisorPartitionedCitationSchema.parse({ raw: "nmap-xml-1", valid: true, kind: "artifact" })
        .valid,
    ).toBe(true);
    expect(
      AdvisorPartitionedCitationSchema.parse({ raw: "ghost", valid: false, kind: "unknown" })
        .kind,
    ).toBe("unknown");
    expect(
      AdvisorPartitionedCitationSchema.safeParse({ raw: "ghost", valid: true, kind: "unknown" })
        .success,
    ).toBe(false);
    expect(
      AdvisorPartitionedCitationSchema.safeParse({ raw: "nmap-xml-1", valid: false, kind: "artifact" })
        .success,
    ).toBe(false);
  });
});
