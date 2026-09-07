// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdvisorPanel } from "./advisor-panel.js";
import { createAppQueryClient } from "../query-client.js";

const ENGAGEMENT_ID = "10000000-0000-4000-8000-000000000001";
const TURN_ID = "10000000-0000-4000-8000-000000000002";

function finding(id: string, title: string) {
  return {
    contractVersion: 1,
    id,
    engagementId: ENGAGEMENT_ID,
    title,
    severity: "medium",
    status: "open",
    body: "",
    evidenceArtifactIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function pendingTurn() {
  return {
    id: TURN_ID,
    engagementId: ENGAGEMENT_ID,
    question: "What does this show?",
    modelId: "test-model",
    redactions: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    answer: "",
    uncertainty: "",
    citations: [],
    abstained: null,
    errorCode: null,
  };
}

function succeededTurn(overrides: Record<string, unknown> = {}) {
  return {
    ...pendingTurn(),
    status: "succeeded",
    answer: "The banner shows HTTP.",
    uncertainty: "Version string was truncated.",
    citations: [{ raw: "artifact-1", valid: true, kind: "artifact" }],
    abstained: false,
    ...overrides,
  };
}

const okStatus = {
  configured: true,
  endpointReachable: true,
  modelId: "test-model",
  endpointHost: "127.0.0.1",
  publicEndpoint: false,
  optIn: false,
  keyEnvVar: "",
  keyPresent: false,
  latencyMs: 3,
  reason: "ok",
};

function response(payload: unknown, status = 200): Response {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

interface PostedCall {
  url: string;
  key: string | null;
  body: unknown;
}

function renderPanel(
  post: (call: PostedCall) => unknown,
  options?: {
    archived?: boolean;
    excerpts?: string[];
    findingIds?: string[];
    status?: unknown;
    findings?: unknown[];
    history?: unknown[];
  },
) {
  const posted: PostedCall[] = [];
  // Stateful history: successful POSTs land in the list the panel reads,
  // mirroring server persistence plus query invalidation.
  const stored: unknown[] = [...(options?.history ?? [])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const headers = new Headers(init?.headers);
        const call = {
          url: String(url),
          key: headers.get("Idempotency-Key"),
          body: JSON.parse(String(init?.body ?? "null")) as unknown,
        };
        posted.push(call);
        const turn = post(call);
        stored.unshift(turn);
        return response(turn);
      }
      if (String(url).includes("/advisor/status")) {
        return response(options?.status ?? okStatus);
      }
      if (String(url).includes("/findings")) {
        return response(options?.findings ?? []);
      }
      if (String(url).includes("/advisor/turns")) {
        return response({ turns: stored, nextCursor: null });
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    }),
  );
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routes: [
      createRootRoute({
        component: () => (
          <QueryClientProvider client={createAppQueryClient()}>
            <AdvisorPanel
              engagementId={ENGAGEMENT_ID}
              archived={options?.archived ?? false}
              excerpts={options?.excerpts ?? ["artifact-1"]}
              findingIds={options?.findingIds ?? []}
              onExcerptsChange={() => {}}
              onFindingIdsChange={() => {}}
              onClose={() => {}}
            />
          </QueryClientProvider>
        ),
      }),
    ],
  });
  render(<RouterProvider router={router} />);
  return { posted, router };
}

async function askQuestion(question: string) {
  const box = screen.getByLabelText(/Question/) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("advisor panel composer", () => {
  it("disables Ask without an excerpt and explains finding-only entry", async () => {
    renderPanel(() => pendingTurn(), { excerpts: [], findingIds: [FINDING_ID] });
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    await screen.findByText("Finding-only questions need at least one evidence excerpt.");
  });

  it("rejects overlong questions by byte count", async () => {
    renderPanel(() => pendingTurn());
    const box = screen.getByLabelText(/Question/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: `é${"x".repeat(2000)}` } });
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("reuses the same key on retry after an ambiguous failure", async () => {
    let calls = 0;
    const { posted } = renderPanel(() => {
      calls += 1;
      if (calls === 1) throw new TypeError("network down");
      return pendingTurn();
    });
    await askQuestion("What does this show?");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[0]?.key).not.toBeNull();
    expect(posted[1]?.key).toBe(posted[0]?.key);
    expect(posted[1]?.body).toEqual(posted[0]?.body);
  });

  it("mints a fresh key only through New attempt", async () => {
    const { posted } = renderPanel(() => pendingTurn());
    await askQuestion("What does this show?");
    await waitFor(() => expect(posted).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "New attempt" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.key).not.toBe(posted[0]?.key);
  });
});

const FINDING_ID = "10000000-0000-4000-8000-000000000003";

function testFinding(id: string, title: string) {
  return {
    contractVersion: 1,
    id,
    engagementId: ENGAGEMENT_ID,
    title,
    severity: "medium",
    status: "open",
    body: "",
    evidenceArtifactIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("advisor panel states", () => {
  it("shows archived history read-only without a composer", async () => {
    renderPanel(() => pendingTurn(), {
      archived: true,
      history: [succeededTurn()],
    });
    await screen.findByText("Archived engagements are read-only.");
    expect(screen.getByLabelText(/Question/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    await screen.findByText("The banner shows HTTP.");
  });

  it("links to settings when the advisor is unconfigured", async () => {
    renderPanel(() => pendingTurn(), { status: { ...okStatus, reason: "unconfigured" } });
    const link = await screen.findByRole("link", { name: "Open Advisor settings" });
    expect(link.getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("renders uncertainty and inert unknown citations without raw HTML", async () => {
    renderPanel(
      () =>
        succeededTurn({
          abstained: false,
          citations: [{ raw: "ghost", valid: false, kind: "unknown" }],
        }),
      { history: [] },
    );
    await askQuestion("What does this show?");
    const panel = screen.getByRole("dialog");
    await within(panel).findByText("Uncertainty");
    within(panel).getByText("unverified: ghost", { exact: false });
    expect(within(panel).queryByRole("link")).toBeNull();
  });

  it("maps terminal failures to friendly messages", async () => {
    renderPanel(
      () => ({
        ...pendingTurn(),
        status: "provider_error",
        errorCode: "provider_unreachable",
      }),
      { history: [] },
    );
    await askQuestion("What does this show?");
    await screen.findByText("The model endpoint did not answer.");
  });

  it("sends checked findings with the selected excerpts", async () => {
    const { posted } = renderPanel(() => pendingTurn(), {
      findings: [testFinding(FINDING_ID, "Open banner")],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Open banner/ }));
    await askQuestion("What does this show?");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toMatchObject({
      excerptArtifactIds: ["artifact-1"],
      findingIds: [FINDING_ID],
    });
  });
});
