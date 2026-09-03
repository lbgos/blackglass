import type { PersistedAction, SavedScopeRule } from "@blackglass/contracts";
import { Button, LoadingRegion, Skeleton, cn } from "@blackglass/ui";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  useAddScopeAndRunActionMutation,
  useCancelActionMutation,
  useContinueActionMutation,
  useCreateActionMutation,
} from "./action-mutations.js";
import {
  actionLifecycleStatusCopy,
  isTerminalActionState,
  persistedActionQueryOptions,
} from "./action-query.js";
import {
  buildAddScopeAndRunRules,
  capabilityErrorCopy,
  formatCanonicalTarget,
  latestActionSnapshot,
  parseDeclaredPorts,
  parsePlannedTargets,
  warningReasonCodes,
  warningReasonSummary,
} from "./action-targets.js";
import { engagementMutationMessage, isRevisionConflict } from "./errors.js";
import { engagementHttpProbesQueryKey, engagementServicesQueryKey, engagementFfufResultsQueryKey, useEngagementDetailQuery } from "./query.js";
import { useEngagementWorkspace } from "./workspace-context.js";

export function ActionPlanner({
  archived,
  engagementId,
}: {
  archived: boolean;
  engagementId: string;
}) {
  const detail = useEngagementDetailQuery(engagementId);
  const hasData = detail.data !== undefined;

  return (
    <section aria-label="Runs" className="mt-5 border-t border-border pt-4" id="engagement-runs">
      <header className="mb-3">
        <h2 className="m-0 text-[13px] font-semibold">Runs</h2>
        <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
          Plan from raw targets. At most one warning appears before queueing. Continue does not
          change saved scope.
        </p>
      </header>
      {!hasData && detail.isFetching ? <PlannerLoadingState /> : null}
      {!hasData && detail.isError ? (
        <p className="m-0 text-[12px] leading-5 text-muted-foreground">
          Runs are unavailable until engagement detail loads.
        </p>
      ) : null}
      {hasData ? (
        <PlannerBody
          key={engagementId}
          archived={archived}
          engagementId={engagementId}
          expectedActiveScopeRevisionId={detail.data.activeScopeRevision?.id ?? null}
          expectedEngagementRevision={detail.data.engagement.revision}
          scopeRules={detail.data.activeScopeRevision?.rules ?? []}
        />
      ) : null}
    </section>
  );
}

function PlannerLoadingState() {
  return (
    <LoadingRegion label="Loading runs" className="space-y-3">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-11 w-full" />
    </LoadingRegion>
  );
}

function PlannerBody({
  archived,
  engagementId,
  expectedActiveScopeRevisionId,
  expectedEngagementRevision,
  scopeRules,
}: {
  archived: boolean;
  engagementId: string;
  expectedActiveScopeRevisionId: string | null;
  expectedEngagementRevision: number;
  scopeRules: readonly SavedScopeRule[];
}) {
  const formId = useId();
  const { focusRunsToken } = useEngagementWorkspace();
  const targetsRef = useRef<HTMLTextAreaElement>(null);
  const [rawTargets, setRawTargets] = useState("");
  const [rawDeclaredPorts, setRawDeclaredPorts] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [portsFieldError, setPortsFieldError] = useState<string | undefined>(undefined);
  const [plannedTargets, setPlannedTargets] = useState<string[]>([]);
  const [result, setResult] = useState<PersistedAction | undefined>(undefined);
  const [outcome, setOutcome] = useState<"queued" | "cancelled" | undefined>(undefined);
  const [queuedBy, setQueuedBy] = useState<"continue" | "add_scope_and_run" | "plan" | undefined>(
    undefined,
  );
  const [trackedActionId, setTrackedActionId] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const hasInvalidatedServicesRef = useRef<string | null>(null);

  const createAction = useCreateActionMutation();

  const polledActionQuery = useQuery({
    ...persistedActionQueryOptions(engagementId, trackedActionId),
    refetchInterval: (query) => {
      const data = query.state.data as PersistedAction | undefined;
      if (data !== undefined && isTerminalActionState(data.action.state)) return false;
      if (query.state.error) return false;
      return 1500;
    },
    retry: false,
  });

  const displayAction = trackedActionId !== undefined ? (polledActionQuery.data ?? result) : undefined;
  const showPollError =
    trackedActionId !== undefined && polledActionQuery.isError && !polledActionQuery.isFetching;

  useEffect(() => {
    hasInvalidatedServicesRef.current = null;
  }, [trackedActionId]);

  useEffect(() => {
    const action = polledActionQuery.data;
    if (action === undefined || trackedActionId === undefined) return;
    if (action.action.actionId !== trackedActionId) return;
    if (action.action.state !== "succeeded") return;
    if (hasInvalidatedServicesRef.current === trackedActionId) return;
    hasInvalidatedServicesRef.current = trackedActionId;
    void queryClient.invalidateQueries({ queryKey: engagementServicesQueryKey(engagementId) });
    void queryClient.invalidateQueries({ queryKey: engagementHttpProbesQueryKey(engagementId) });
    void queryClient.invalidateQueries({ queryKey: engagementFfufResultsQueryKey(engagementId) });
  }, [engagementId, polledActionQuery.data, queryClient, trackedActionId]);

  useEffect(() => {
    if (focusRunsToken === 0) return;
    const section = document.getElementById("engagement-runs");
    if (section !== null && typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ block: "nearest" });
    }
    if (!archived) targetsRef.current?.focus();
  }, [archived, focusRunsToken]);

  const mutationError = firstMutationError([createAction]);
  const canPlan = !archived && !createAction.isPending;

  const plan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPlan) return;
    createAction.reset();
    setResult(undefined);
    setOutcome(undefined);
    setQueuedBy(undefined);
    setTrackedActionId(undefined);
    const parsed = parsePlannedTargets(rawTargets);
    const parsedPorts = parseDeclaredPorts(rawDeclaredPorts);
    if (!parsed.ok) setFieldError(parsed.message);
    else setFieldError(undefined);
    if (!parsedPorts.ok) setPortsFieldError(parsedPorts.message);
    else setPortsFieldError(undefined);
    if (!parsed.ok || !parsedPorts.ok) return;
    setPlannedTargets(parsed.targets);
    createAction.mutate(
      {
        engagementId,
        expectedEngagementRevision,
        expectedActiveScopeRevisionId,
        targets: parsed.targets,
        declaredPorts: parsedPorts.declaredPorts,
      },
      {
        onSuccess: (action) => {
          setResult(action);
          if (action.action.state === "queued") {
            setOutcome("queued");
            setQueuedBy("plan");
            setTrackedActionId(action.action.actionId);
          }
        },
      },
    );
  };

  const applyResult = (
    action: PersistedAction,
    nextOutcome: "queued" | "cancelled",
    nextQueuedBy?: "continue" | "add_scope_and_run",
  ) => {
    setResult(action);
    setOutcome(nextOutcome);
    setQueuedBy(nextQueuedBy);
    if (nextOutcome === "queued" && action.action.state === "queued") {
      setTrackedActionId(action.action.actionId);
    } else {
      setTrackedActionId(undefined);
    }
  };

  return (
    <div>
      {archived && (
        <p className="mb-3 text-[12px] leading-5 text-muted-foreground">
          This engagement is archived. Actions cannot be planned.
        </p>
      )}
      <form className="grid gap-3" onSubmit={plan}>
        <label className="grid gap-1 text-[11px] text-muted-foreground" htmlFor={`${formId}-targets`}>
          <span>Targets</span>
          <textarea
            ref={targetsRef}
            id={`${formId}-targets`}
            name="targets"
            value={rawTargets}
            rows={3}
            placeholder={"192.0.2.10\n198.51.100.10"}
            autoComplete="off"
            spellCheck={false}
            disabled={archived || createAction.isPending}
            aria-invalid={fieldError !== undefined}
            className={cn(
              "min-h-20 w-full rounded-md border bg-transparent px-2.5 py-2 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              fieldError !== undefined ? "border-destructive" : "border-input",
            )}
            onChange={(event) => setRawTargets(event.target.value)}
          />
          {fieldError && (
            <span className="text-destructive" role="alert">
              {fieldError}
            </span>
          )}
        </label>
        <label className="grid gap-1 text-[11px] text-muted-foreground" htmlFor={`${formId}-ports`}>
          <span>TCP ports <span className="font-normal opacity-70">Optional</span></span>
          <input
            id={`${formId}-ports`}
            name="declaredPorts"
            value={rawDeclaredPorts}
            placeholder="22,80,443"
            autoComplete="off"
            spellCheck={false}
            disabled={archived || createAction.isPending}
            aria-invalid={portsFieldError !== undefined}
            className={cn(
              "h-9 w-full rounded-md border bg-transparent px-2.5 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              portsFieldError !== undefined ? "border-destructive" : "border-input",
            )}
            onChange={(event) => setRawDeclaredPorts(event.target.value)}
          />
          {portsFieldError && (
            <span className="text-destructive" role="alert">
              {portsFieldError}
            </span>
          )}
        </label>
        {mutationError && (
          <p className="m-0 text-[13px] text-destructive" role="alert">
            {mutationError}
          </p>
        )}
        <div>
          <Button type="submit" disabled={!canPlan}>
            {createAction.isPending ? "Planning" : "Plan action"}
          </Button>
        </div>
      </form>

      {createAction.isPending ? (
        <LoadingRegion label="Planning action" className="mt-4">
          <Skeleton className="h-16 w-full" />
        </LoadingRegion>
      ) : null}

      {result?.action.state === "capability_error" && result.action.capabilityErrorCode !== null ? (
        <div className="mt-4 rounded-[10px] border border-destructive/35 bg-destructive/10 px-3 py-3" role="alert">
          <h3 className="m-0 text-[13px] font-semibold text-foreground">This action cannot run</h3>
          <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
            {capabilityErrorCopy(result.action.capabilityErrorCode)}
          </p>
        </div>
      ) : null}

      {result?.action.state === "paused_for_warning" ? (
        <WarningCard
          action={result}
          engagementId={engagementId}
          expectedEngagementRevision={expectedEngagementRevision}
          plannedTargets={plannedTargets}
          scopeRules={scopeRules}
          onAddScopeAndRun={(action) => applyResult(action, "queued", "add_scope_and_run")}
          onCancel={(action) => applyResult(action, "cancelled")}
          onContinue={(action) => applyResult(action, "queued", "continue")}
        />
      ) : null}

      {trackedActionId !== undefined && displayAction !== undefined ? (
        <TrackedActionStatus
          action={displayAction}
          scopeUpdated={queuedBy === "add_scope_and_run"}
          showPollError={showPollError}
          onRefresh={() => void polledActionQuery.refetch()}
        />
      ) : null}

      {outcome === "cancelled" && result?.action.state === "cancelled" ? (
        <p className="mt-4 mb-0 text-[13px] text-muted-foreground" role="status">
          Action cancelled. No warning acknowledgment was recorded.
        </p>
      ) : null}
    </div>
  );
}

// Shared single-warning card: every representable action (nmap, HTTP probe,
// ffuf discovery) continues, adds scope, or cancels through this one UI.
export function WarningCard({
  action,
  engagementId,
  expectedEngagementRevision,
  onAddScopeAndRun,
  onCancel,
  onContinue,
  plannedTargets,
  scopeRules,
}: {
  action: PersistedAction;
  engagementId: string;
  expectedEngagementRevision: number;
  onAddScopeAndRun: (action: PersistedAction) => void;
  onCancel: (action: PersistedAction) => void;
  onContinue: (action: PersistedAction) => void;
  plannedTargets: readonly string[];
  scopeRules: readonly SavedScopeRule[];
}) {
  const titleId = useId();
  const continueAction = useContinueActionMutation();
  const addScopeAndRun = useAddScopeAndRunActionMutation();
  const cancelAction = useCancelActionMutation();
  const snapshot = latestActionSnapshot(action);
  const reasonCodes = warningReasonCodes(action);
  const showAddToScope = reasonCodes.includes("outside_scope");
  const addScopeRules = useMemo(
    () => buildAddScopeAndRunRules(scopeRules, action, plannedTargets),
    [action, plannedTargets, scopeRules],
  );
  const pending = continueAction.isPending || addScopeAndRun.isPending || cancelAction.isPending;
  const mutationError = firstMutationError([continueAction, addScopeAndRun, cancelAction]);

  const submitContinue = () => {
    if (pending) return;
    continueAction.mutate(
      {
        engagementId,
        actionId: action.action.actionId,
        expectedRevision: action.revision,
        snapshotVersion: snapshot.version,
        snapshotBinding: snapshot.binding,
      },
      { onSuccess: onContinue },
    );
  };

  const submitAddToScope = () => {
    if (pending) return;
    addScopeAndRun.mutate(
      {
        engagementId,
        actionId: action.action.actionId,
        expectedEngagementRevision,
        expectedActionRevision: action.revision,
        rules: addScopeRules,
      },
      { onSuccess: onAddScopeAndRun },
    );
  };

  const submitCancel = () => {
    if (pending) return;
    cancelAction.mutate(
      {
        engagementId,
        actionId: action.action.actionId,
        expectedRevision: action.revision,
      },
      { onSuccess: onCancel },
    );
  };

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      submitCancel();
      return;
    }
    if (event.key !== "Enter") return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === "BUTTON" || tag === "SUMMARY" || tag === "A" || tag === "TEXTAREA") return;
    }
    event.preventDefault();
    submitContinue();
  };

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-copy`}
      className="mt-4 rounded-[10px] border border-warning/35 bg-warning/10 px-3 py-3"
      data-keybinding-capture=""
      onKeyDown={onCardKeyDown}
    >
      <h3 id={titleId} className="m-0 text-[13px] font-semibold text-foreground">
        Action needs a warning
      </h3>
      <p className="mt-1 mb-0 text-[12px] leading-5 text-foreground">{warningReasonSummary(reasonCodes)}</p>
      <p id={`${titleId}-copy`} className="mt-2 mb-0 text-[12px] leading-5 text-muted-foreground">
        One acknowledgment covers the whole action. Scope is context, not authorization. Continue
        does not change saved scope.
      </p>
      {mutationError && (
        <p className="mt-2 mb-0 text-[13px] text-destructive" role="alert">
          {mutationError}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button autoFocus disabled={pending} onClick={submitContinue} type="button">
          {continueAction.isPending ? "Continuing" : "Continue"}
        </Button>
        {showAddToScope ? (
          <Button disabled={pending} onClick={submitAddToScope} type="button" variant="secondary">
            {addScopeAndRun.isPending ? "Adding" : "Add to scope & run"}
          </Button>
        ) : null}
        <Button disabled={pending} onClick={submitCancel} type="button" variant="quiet">
          {cancelAction.isPending ? "Cancelling" : "Cancel"}
        </Button>
      </div>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer text-[12px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8">
          Normalized targets
        </summary>
        <ul className="mt-1 mb-0 list-none p-0">
          {snapshot.canonicalTargets.map((target) => (
            <li key={formatCanonicalTarget(target)} className="font-mono text-[12px] text-foreground">
              {formatCanonicalTarget(target)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function TrackedActionStatus({
  action,
  onRefresh,
  scopeUpdated,
  showPollError,
}: {
  action: PersistedAction;
  onRefresh: () => void;
  scopeUpdated: boolean;
  showPollError: boolean;
}) {
  const snapshot = latestActionSnapshot(action);
  const statusText = actionLifecycleStatusCopy(action.action);
  const isQueued = action.action.state === "queued";
  return (
    <div className="mt-4">
      <p className="mb-0 text-[13px] text-foreground" role="status">
        {isQueued ? "Action queued" : statusText}
        {isQueued
          ? scopeUpdated
            ? ". A new saved-scope revision was created."
            : ". Saved scope was not changed."
          : ""}{" "}
        <span className="font-mono text-[12px] text-muted-foreground">
          {action.action.actionId} · snapshot {snapshot.version}
        </span>
      </p>
      {showPollError ? (
        <p className="mt-2 mb-0 flex items-center gap-2 text-[12px] text-muted-foreground" role="status">
          <span>Status update failed.</span>
          <Button type="button" variant="quiet" className="h-7 px-2 text-[12px]" onClick={onRefresh}>
            Refresh
          </Button>
        </p>
      ) : null}
    </div>
  );
}

function firstMutationError(
  mutations: ReadonlyArray<{ isError: boolean; error: unknown }>,
): string | undefined {
  for (const mutation of mutations) {
    if (!mutation.isError) continue;
    if (isRevisionConflict(mutation.error)) return mutation.error.message;
    return engagementMutationMessage(mutation.error);
  }
  return undefined;
}
