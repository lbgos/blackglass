import { isTerminalRunState } from "@stonehush/domain";
import { useEffect, useRef, useState } from "react";

import { useRunHistoryQuery } from "./run-history-query.js";

// Execution tray and stable-order helpers for STONE-2.
//
// The tray is a compact read-only strip: it shows active work and adds a
// quiet finished indicator when background runs complete. It never steals
// focus, never opens output over reading material, and issues no model or
// mutation requests. Result order stays stable in the run history panel:
// newly arrived runs are held back behind an explicit Show new results
// affordance instead of shifting rows while the operator reads or selects
// text. Updates to already visible rows (state changes, removals) still
// render immediately so progress and exact-output fetching keep working.

export interface HeldBackSplit {
  readonly heldBackCount: number;
  readonly visibleIds: readonly string[];
}

export function splitHeldBackIds(
  currentIds: readonly string[],
  baselineIds: readonly string[] | undefined,
  pinnedId: string | undefined,
): HeldBackSplit {
  if (baselineIds === undefined) return { heldBackCount: 0, visibleIds: currentIds };
  const baseline = new Set(baselineIds);
  return {
    heldBackCount: currentIds.filter((id) => !baseline.has(id) && id !== pinnedId).length,
    visibleIds: currentIds.filter((id) => baseline.has(id) || id === pinnedId),
  };
}

function shortRunId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export interface ExecutionTrayProps {
  readonly engagementId: string;
  readonly onOpenRun: (runId: string) => void;
}

export function ExecutionTray({ engagementId, onOpenRun }: ExecutionTrayProps) {
  const history = useRunHistoryQuery(engagementId);
  const [baseline, setBaseline] = useState<
    { engagementId: string; terminalIds: readonly string[] } | undefined
  >(undefined);
  if (baseline !== undefined && baseline.engagementId !== engagementId) {
    setBaseline(undefined);
  }
  if (baseline === undefined && history.data !== undefined) {
    setBaseline({
      engagementId,
      terminalIds: history.data.pages
        .flatMap((page) => page.runs)
        .filter((run) => isTerminalRunState(run.state))
        .map((run) => run.id),
    });
  }

  const runs = history.data?.pages.flatMap((page) => page.runs) ?? [];
  const active = runs.filter((run) => !isTerminalRunState(run.state));
  const baselineTerminal = baseline === undefined ? undefined : new Set(baseline.terminalIds);
  const finished =
    baselineTerminal === undefined
      ? []
      : runs.filter((run) => isTerminalRunState(run.state) && !baselineTerminal.has(run.id));

  const refetchRef = useRef(history.refetch);
  useEffect(() => {
    refetchRef.current = history.refetch;
  });
  const hasActive = active.length > 0;
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      void refetchRef.current();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [engagementId, hasActive]);

  if (history.data === undefined || history.isError) return null;
  if (active.length === 0 && finished.length === 0) return null;

  // Runs arrive newest-first, so the first finished entry is the most recent.
  const latestFinished = finished[0];

  return (
    <section
      aria-label="Execution tray"
      className="mt-5 overflow-hidden rounded-[10px] border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <p className="m-0 text-[12px] text-muted-foreground" aria-live="polite">
          {active.length} active
          {finished.length > 0 ? (
            <>
              {" · "}
              {finished.length} finished
              {latestFinished === undefined ? null : (
                <button
                  type="button"
                  title={latestFinished.id}
                  onClick={() => onOpenRun(latestFinished.id)}
                  className="font-mono text-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded px-0.5"
                >
                  {" "}
                  ({shortRunId(latestFinished.id)})
                </button>
              )}
            </>
          ) : null}
        </p>
        {active.slice(0, 3).map((run) => (
          <button
            key={run.id}
            type="button"
            title={run.id}
            onClick={() => onOpenRun(run.id)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{run.state}</span>
            <span className="text-muted-foreground">{shortRunId(run.id)}</span>
          </button>
        ))}
        {active.length > 3 ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            +{active.length - 3} more
          </span>
        ) : null}
      </div>
    </section>
  );
}
