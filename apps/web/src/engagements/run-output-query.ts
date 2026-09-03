import {
  RunOutputResponseSchema,
  type RunOutputResponse,
} from "@blackglass/contracts";
import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";

export const RUN_OUTPUT_QUERY_ERROR_MESSAGE = "The raw output request failed.";

export class RunOutputQueryError extends Error {
  constructor() {
    super(RUN_OUTPUT_QUERY_ERROR_MESSAGE);
    this.name = "RunOutputQueryError";
  }
}

export class NoTerminalRunError extends Error {
  constructor() {
    super("No finished or cancelled runs yet.");
    this.name = "NoTerminalRunError";
  }
}

export function latestRunOutputQueryKey(engagementId: string) {
  return ["engagements", engagementId, "runs", "latest", "output"] as const;
}

export async function fetchLatestRunOutput(
  engagementId: string,
  signal?: AbortSignal,
): Promise<RunOutputResponse> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/engagements/${encodeURIComponent(engagementId)}/runs/latest/output`,
      signal ? { signal } : undefined,
    );
  } catch {
    throw new RunOutputQueryError();
  }
  if (response.status === 404) {
    let code: unknown = undefined;
    try {
      code = (await response.json() as { code?: unknown }).code;
    } catch {
      throw new RunOutputQueryError();
    }
    if (code === "no_terminal_run") throw new NoTerminalRunError();
    throw new RunOutputQueryError();
  }
  if (response.status !== 200) throw new RunOutputQueryError();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RunOutputQueryError();
  }
  const result = RunOutputResponseSchema.safeParse(payload);
  if (!result.success) throw new RunOutputQueryError();
  return result.data;
}

export function latestRunOutputQueryOptions(engagementId: string | undefined) {
  return queryOptions({
    queryKey:
      engagementId === undefined
        ? ["engagements", "runs", "latest", "output", "none"]
        : latestRunOutputQueryKey(engagementId),
    queryFn:
      engagementId === undefined
        ? skipToken
        : ({ signal }) => fetchLatestRunOutput(engagementId, signal),
    retry: false,
  });
}

export function useLatestRunOutputQuery(engagementId: string | undefined) {
  return useQuery(latestRunOutputQueryOptions(engagementId));
}

export function selectEngagementIdFromPathname(pathname: string): string | undefined {
  const match = /^\/engagements\/([^/]+)/.exec(pathname);
  const candidate = match?.[1];
  return candidate === undefined || candidate.length === 0 ? undefined : candidate;
}
