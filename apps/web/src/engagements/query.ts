import {
  EngagementDetailResponseSchema,
  EngagementListResponseSchema,
  EngagementServicesResponseSchema,
  type Engagement,
  type EngagementWithActiveScope,
  type NmapProjectedService,
} from "@blackglass/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { EngagementDetailQueryError, EngagementsQueryError } from "./errors.js";

export const ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE = "The services request failed.";

export class EngagementServicesQueryError extends Error {
  constructor() {
    super(ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE);
    this.name = "EngagementServicesQueryError";
  }
}

export const ENGAGEMENTS_QUERY_KEY = ["engagements"] as const;

export function engagementDetailQueryKey(engagementId: string) {
  return [...ENGAGEMENTS_QUERY_KEY, engagementId] as const;
}

export function engagementServicesQueryKey(engagementId: string) {
  return [...ENGAGEMENTS_QUERY_KEY, engagementId, "services"] as const;
}

export async function fetchEngagements(signal?: AbortSignal): Promise<Engagement[]> {
  try {
    const response = await fetch("/api/v1/engagements", signal ? { signal } : undefined);
    if (response.status !== 200) throw new EngagementsQueryError();

    const payload: unknown = await response.json();
    const result = EngagementListResponseSchema.safeParse(payload);
    if (!result.success) throw new EngagementsQueryError();
    return result.data;
  } catch (error) {
    if (error instanceof EngagementsQueryError) throw error;
    throw new EngagementsQueryError();
  }
}

export async function fetchEngagementDetail(
  engagementId: string,
  signal?: AbortSignal,
): Promise<EngagementWithActiveScope> {
  try {
    const response = await fetch(
      `/api/v1/engagements/${engagementId}`,
      signal ? { signal } : undefined,
    );
    if (response.status !== 200) throw new EngagementDetailQueryError();

    const payload: unknown = await response.json();
    const result = EngagementDetailResponseSchema.safeParse(payload);
    if (!result.success) throw new EngagementDetailQueryError();
    return result.data;
  } catch (error) {
    if (error instanceof EngagementDetailQueryError) throw error;
    throw new EngagementDetailQueryError();
  }
}

export async function fetchEngagementServices(
  engagementId: string,
  signal?: AbortSignal,
): Promise<NmapProjectedService[]> {
  try {
    const response = await fetch(
      `/api/v1/engagements/${engagementId}/services`,
      signal ? { signal } : undefined,
    );
    if (response.status !== 200) throw new EngagementServicesQueryError();

    const payload: unknown = await response.json();
    const result = EngagementServicesResponseSchema.safeParse(payload);
    if (!result.success) throw new EngagementServicesQueryError();
    return result.data;
  } catch (error) {
    if (error instanceof EngagementServicesQueryError) throw error;
    throw new EngagementServicesQueryError();
  }
}

export const engagementsQueryOptions = queryOptions({
  queryKey: ENGAGEMENTS_QUERY_KEY,
  queryFn: ({ signal }) => fetchEngagements(signal),
});

export function engagementDetailQueryOptions(engagementId: string) {
  return queryOptions({
    queryKey: engagementDetailQueryKey(engagementId),
    queryFn: ({ signal }) => fetchEngagementDetail(engagementId, signal),
  });
}

export function engagementServicesQueryOptions(engagementId: string) {
  return queryOptions({
    queryKey: engagementServicesQueryKey(engagementId),
    queryFn: ({ signal }) => fetchEngagementServices(engagementId, signal),
  });
}

export function useEngagementsQuery() {
  return useQuery(engagementsQueryOptions);
}

export function useEngagementDetailQuery(engagementId: string) {
  return useQuery(engagementDetailQueryOptions(engagementId));
}

export function useEngagementServicesQuery(engagementId: string) {
  return useQuery(engagementServicesQueryOptions(engagementId));
}

export function partitionEngagements(engagements: readonly Engagement[]) {
  const active: Engagement[] = [];
  const archived: Engagement[] = [];
  for (const engagement of engagements) {
    if (engagement.status === "archived") archived.push(engagement);
    else active.push(engagement);
  }
  return { active, archived };
}
