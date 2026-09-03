import {
  ActionMutationErrorSchema,
  EngagementMutationErrorSchema,
  type ActionMutationError,
  type EngagementMutationError,
} from "@blackglass/contracts";

export const ENGAGEMENTS_QUERY_ERROR_MESSAGE = "The engagement list request failed.";
export const ENGAGEMENT_DETAIL_QUERY_ERROR_MESSAGE = "The engagement request failed.";
export const ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE = "The services request failed.";
export const ENGAGEMENT_HTTP_PROBES_QUERY_ERROR_MESSAGE = "The probe results request failed.";
export const ENGAGEMENT_MUTATION_ERROR_MESSAGE = "The engagement request failed.";

export const ENGAGEMENT_MUTATION_ERROR_COPY = {
  invalid_request: "The request was not accepted. Check the fields and try again.",
  engagement_not_found: "That engagement is no longer available.",
  engagement_archived: "This engagement is archived.",
  invalid_engagement_transition: "That lifecycle action is not valid now.",
  idempotency_conflict: "This request did not match a previous attempt. Try again.",
  revision_conflict: "This engagement changed. Showing the latest revision.",
  invalid_persisted_data: "The server returned data this client cannot use.",
  storage_busy: "Storage is busy. Try again.",
  request_failed: ENGAGEMENT_MUTATION_ERROR_MESSAGE,
} as const;

export const ACTION_MUTATION_ERROR_COPY = {
  action_not_found: "That action is no longer available.",
  invalid_action_transition: "That action is not valid now.",
  action_already_queued: "That action is already queued.",
  capability_error_not_overridable: "This action cannot run. Continue is not available.",
  snapshot_binding_mismatch: "The action snapshot changed. Showing the latest revision.",
  invalid_run_transition: "That run action is not valid now.",
  run_not_retryable: "That run cannot be retried.",
} as const;

const OPERATOR_MUTATION_ERROR_COPY = {
  ...ENGAGEMENT_MUTATION_ERROR_COPY,
  ...ACTION_MUTATION_ERROR_COPY,
} as const;

export type OperatorMutationErrorCode = keyof typeof OPERATOR_MUTATION_ERROR_COPY;

export class EngagementsQueryError extends Error {
  constructor() {
    super(ENGAGEMENTS_QUERY_ERROR_MESSAGE);
    this.name = "EngagementsQueryError";
  }
}

export class EngagementDetailQueryError extends Error {
  constructor() {
    super(ENGAGEMENT_DETAIL_QUERY_ERROR_MESSAGE);
    this.name = "EngagementDetailQueryError";
  }
}

export class EngagementServicesQueryError extends Error {
  constructor() {
    super(ENGAGEMENT_SERVICES_QUERY_ERROR_MESSAGE);
    this.name = "EngagementServicesQueryError";
  }
}

export class EngagementHttpProbesQueryError extends Error {
  constructor() {
    super(ENGAGEMENT_HTTP_PROBES_QUERY_ERROR_MESSAGE);
    this.name = "EngagementHttpProbesQueryError";
  }
}

export class EngagementMutationClientError extends Error {
  readonly code: OperatorMutationErrorCode;
  readonly currentRevision?: number;
  readonly resourceId?: string;
  readonly resourceType?: "action" | "engagement";

  constructor(
    code: OperatorMutationErrorCode,
    details?: { currentRevision: number; resourceId: string; resourceType?: "action" | "engagement" },
  ) {
    super(OPERATOR_MUTATION_ERROR_COPY[code]);
    this.name = "EngagementMutationClientError";
    this.code = code;
    if (details) {
      this.currentRevision = details.currentRevision;
      this.resourceId = details.resourceId;
      if (details.resourceType !== undefined) this.resourceType = details.resourceType;
    }
  }
}

export function isRevisionConflict(
  error: unknown,
): error is EngagementMutationClientError & {
  code: "revision_conflict";
  currentRevision: number;
} {
  return (
    error instanceof EngagementMutationClientError &&
    error.code === "revision_conflict" &&
    typeof error.currentRevision === "number"
  );
}

export function parseEngagementMutationError(payload: unknown): EngagementMutationClientError {
  const engagement = EngagementMutationErrorSchema.safeParse(payload);
  if (engagement.success) return mutationErrorFromContract(engagement.data);
  const action = ActionMutationErrorSchema.safeParse(payload);
  if (action.success) return mutationErrorFromActionContract(action.data);
  return new EngagementMutationClientError("request_failed");
}

export function mutationErrorFromContract(
  error: EngagementMutationError,
): EngagementMutationClientError {
  if (error.code === "revision_conflict") {
    return new EngagementMutationClientError("revision_conflict", {
      currentRevision: error.currentRevision,
      resourceId: error.resourceId,
      resourceType: "engagement",
    });
  }
  return new EngagementMutationClientError(error.code);
}

export function mutationErrorFromActionContract(
  error: ActionMutationError,
): EngagementMutationClientError {
  if (error.code === "revision_conflict") {
    return new EngagementMutationClientError("revision_conflict", {
      currentRevision: error.currentRevision,
      resourceId: error.resourceId,
      resourceType: error.resourceType,
    });
  }
  return new EngagementMutationClientError(error.code);
}

export function engagementMutationMessage(error: unknown): string {
  if (error instanceof EngagementMutationClientError) return error.message;
  return ENGAGEMENT_MUTATION_ERROR_MESSAGE;
}
