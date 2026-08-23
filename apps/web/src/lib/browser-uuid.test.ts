// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createIdempotencyKey } from "../engagements/idempotency.js";
import { createDraftScopeRule } from "../engagements/scope-rules.js";
import { createBrowserUuid } from "./browser-uuid.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("browser UUIDs", () => {
  it("sets the UUID v4 version and variant bits", () => {
    const uuid = createBrowserUuid({
      getRandomValues: (bytes) => {
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).fill(0xff);
        return bytes;
      },
    });

    expect(uuid).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("fails closed when cryptographic randomness is unavailable", () => {
    vi.stubGlobal("crypto", {});
    expect(() => createBrowserUuid()).toThrow("crypto.getRandomValues is required");
  });

  it("supports engagement mutations and scope rules without randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0x22);
        return bytes;
      },
    });

    expect(createIdempotencyKey()).toMatch(UUID_V4);
    const result = createDraftScopeRule({
      includeSubdomains: false,
      portRanges: "",
      rawTarget: "198.51.100.10",
    });
    expect(result.ok && result.rule.id).toMatch(UUID_V4);
  });
});
