import {
  EngagementNotesResponseSchema,
  UpdateEngagementNotesRequestSchema,
  type EngagementNotes,
} from "@blackglass/contracts";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  EngagementMutationClientError,
  parseEngagementMutationError,
} from "./errors.js";
import { reportQueryKey } from "./report-query.js";

export const ENGAGEMENT_NOTES_QUERY_ERROR_MESSAGE = "The notes request failed.";

export class EngagementNotesQueryError extends Error {
  constructor() {
    super(ENGAGEMENT_NOTES_QUERY_ERROR_MESSAGE);
    this.name = "EngagementNotesQueryError";
  }
}

export function engagementNotesQueryKey(engagementId: string) {
  return ["engagements", engagementId, "notes"] as const;
}

export async function fetchEngagementNotes(
  engagementId: string,
  signal?: AbortSignal,
): Promise<EngagementNotes> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/engagements/${engagementId}/notes`,
      signal ? { signal } : undefined,
    );
  } catch {
    throw new EngagementNotesQueryError();
  }
  if (response.status !== 200) throw new EngagementNotesQueryError();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EngagementNotesQueryError();
  }
  const result = EngagementNotesResponseSchema.safeParse(payload);
  if (!result.success) throw new EngagementNotesQueryError();
  return result.data;
}

export async function saveEngagementNotesRequest(
  engagementId: string,
  markdown: string,
  signal?: AbortSignal,
): Promise<EngagementNotes> {
  const body = UpdateEngagementNotesRequestSchema.parse({ markdown });
  let response: Response;
  try {
    response = await fetch(`/api/v1/engagements/${engagementId}/notes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new EngagementMutationClientError("request_failed");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EngagementMutationClientError("request_failed");
  }
  if (response.status !== 200) throw parseEngagementMutationError(payload);
  const parsed = EngagementNotesResponseSchema.safeParse(payload);
  if (!parsed.success) throw new EngagementMutationClientError("invalid_persisted_data");
  return parsed.data;
}

export function engagementNotesQueryOptions(engagementId: string) {
  return queryOptions({
    queryKey: engagementNotesQueryKey(engagementId),
    queryFn: ({ signal }) => fetchEngagementNotes(engagementId, signal),
  });
}

export function useEngagementNotesQuery(engagementId: string) {
  return useQuery(engagementNotesQueryOptions(engagementId));
}

export function useSaveEngagementNotesMutation(engagementId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (markdown: string) => saveEngagementNotesRequest(engagementId, markdown),
    onSuccess: (notes) => {
      queryClient.setQueryData<EngagementNotes>(
        engagementNotesQueryKey(engagementId),
        notes,
      );
      void queryClient.invalidateQueries({ queryKey: reportQueryKey(engagementId) });
    },
  });
}

export function useEngagementNotesEditor(engagementId: string) {
  const query = useEngagementNotesQuery(engagementId);
  const save = useSaveEngagementNotesMutation(engagementId);
  const serverMarkdown = query.data?.markdown;
  const [draft, setDraft] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDraft(undefined);
  }, [engagementId]);
  useEffect(() => {
    if (serverMarkdown !== undefined) {
      setDraft((current) => (current === undefined ? serverMarkdown : current));
    }
  }, [serverMarkdown]);
  const value = draft ?? serverMarkdown ?? "";
  const dirty = draft !== undefined && draft !== (serverMarkdown ?? "");
  return { query, save, value, dirty, setDraft };
}
