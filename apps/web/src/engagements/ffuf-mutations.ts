import {
  FfufDiscoveryLaunchSchema,
  type PersistedAction,
} from "@blackglass/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { isRevisionConflict } from "./errors.js";
import { createIntentKeyHolder, requestFingerprint } from "./idempotency.js";
import { sendActionMutation } from "./mutations.js";
import { ENGAGEMENTS_QUERY_KEY, engagementDetailQueryKey } from "./query.js";

export interface FfufDiscoveryInput {
  engagementId: string;
  expectedEngagementRevision: number;
  expectedActiveScopeRevisionId: string | null;
  origin: string;
  wordlistPath: string;
  rate: number;
  threads: number;
  timeoutSeconds: number;
  maxTimeSeconds: number;
  matchStatusCodes: readonly number[];
}

export async function launchFfufDiscoveryRequest(
  input: FfufDiscoveryInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PersistedAction> {
  const body = FfufDiscoveryLaunchSchema.parse({
    expectedEngagementRevision: input.expectedEngagementRevision,
    expectedActiveScopeRevisionId: input.expectedActiveScopeRevisionId,
    origin: input.origin,
    wordlistPath: input.wordlistPath,
    rate: input.rate,
    threads: input.threads,
    timeoutSeconds: input.timeoutSeconds,
    maxTimeSeconds: input.maxTimeSeconds,
    matchStatusCodes: [...input.matchStatusCodes],
  });
  return sendActionMutation(`/api/v1/engagements/${input.engagementId}/ffuf-discoveries`, {
    body,
    idempotencyKey,
    ...(signal ? { signal } : {}),
  });
}

export function useLaunchFfufDiscoveryMutation() {
  const queryClient = useQueryClient();
  const keys = useRef(createIntentKeyHolder());

  return useMutation({
    mutationFn: (input: FfufDiscoveryInput) => {
      const body = FfufDiscoveryLaunchSchema.parse({
        expectedEngagementRevision: input.expectedEngagementRevision,
        expectedActiveScopeRevisionId: input.expectedActiveScopeRevisionId,
        origin: input.origin,
        wordlistPath: input.wordlistPath,
        rate: input.rate,
        threads: input.threads,
        timeoutSeconds: input.timeoutSeconds,
        maxTimeSeconds: input.maxTimeSeconds,
        matchStatusCodes: [...input.matchStatusCodes],
      });
      const intent = requestFingerprint({
        engagementId: input.engagementId,
        ...body,
      });
      return launchFfufDiscoveryRequest(input, keys.current.keyFor(intent));
    },
    onSuccess: (_action, input) => {
      keys.current.reset(
        requestFingerprint({
          engagementId: input.engagementId,
          expectedEngagementRevision: input.expectedEngagementRevision,
          expectedActiveScopeRevisionId: input.expectedActiveScopeRevisionId,
          origin: input.origin,
          wordlistPath: input.wordlistPath,
          rate: input.rate,
          threads: input.threads,
          timeoutSeconds: input.timeoutSeconds,
          maxTimeSeconds: input.maxTimeSeconds,
          matchStatusCodes: [...input.matchStatusCodes],
        }),
      );
    },
    onError: async (error, input) => {
      if (isRevisionConflict(error)) {
        await queryClient.invalidateQueries({
          queryKey: engagementDetailQueryKey(input.engagementId),
        });
        await queryClient.invalidateQueries({ queryKey: ENGAGEMENTS_QUERY_KEY });
      }
    },
  });
}
