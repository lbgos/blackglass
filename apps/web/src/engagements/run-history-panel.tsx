import type { RunOutputResponse } from "@blackglass/contracts";
import {
  Button,
  LoadingRegion,
  RecoverableError,
  Skeleton,
  StaleDataState,
} from "@blackglass/ui";

import { formatEngagementTimestamp } from "./format.js";
import { useRunHistoryQuery } from "./run-history-query.js";
import { RunNotFoundError, useRunOutputQuery } from "./run-output-query.js";

export interface RunHistoryPanelProps {
  readonly engagementId: string | undefined;
  readonly limit?: number;
  readonly onSelect: (runId: string) => void;
  readonly selectedRunId: string | undefined;
}

// Read-only engagement run history. The list renders in API order
// (newest first) without client-side resorting. Selection is fully
// caller-controlled: this panel only reports clicks through onSelect and
// never auto-selects the newest run. Paging uses the scoped infinite query
// and Load more forwards the opaque cursor verbatim.
export function RunHistoryPanel({
  engagementId,
  limit,
  onSelect,
  selectedRunId,
}: RunHistoryPanelProps) {
  const history = useRunHistoryQuery(engagementId, limit);
  const hasHistoryData = history.data !== undefined;
  const retryHistory = () => void history.refetch();

  if (engagementId === undefined) {
    return (
      <section aria-label="Run history">
        <h2 className="m-0 text-[13px] font-semibold">Run history</h2>
        <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
          Open an engagement to view its preserved run history.
        </p>
      </section>
    );
  }

  if (!hasHistoryData && history.isFetching) {
    return (
      <section aria-label="Run history">
        <h2 className="m-0 text-[13px] font-semibold">Run history</h2>
        <LoadingRegion label="Loading run history" className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </LoadingRegion>
      </section>
    );
  }

  if (!hasHistoryData && history.isError) {
    return (
      <section aria-label="Run history">
        <h2 className="m-0 text-[13px] font-semibold">Run history</h2>
        <div className="mt-3">
          <RecoverableError
            title="Run history unavailable"
            description="The run history could not be loaded from the local control plane."
            onRetry={retryHistory}
          />
        </div>
      </section>
    );
  }

  if (!hasHistoryData) {
    return (
      <section aria-label="Run history">
        <h2 className="m-0 text-[13px] font-semibold">Run history</h2>
        <LoadingRegion label="Loading run history" className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </LoadingRegion>
      </section>
    );
  }

  const runs = history.data.pages.flatMap((page) => page.runs);
  const listBody =
    runs.length === 0 ? (
      <div>
        <h3 className="m-0 text-[13px] font-semibold">No runs yet</h3>
        <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
          Queue an action to produce preserved runs for this engagement.
        </p>
      </div>
    ) : (
      <div>
        <p className="m-0 mb-2 text-[12px] text-muted-foreground" aria-live="polite">
          {runs.length} {runs.length === 1 ? "run" : "runs"} shown, newest first
        </p>
        <ul className="m-0 list-none divide-y divide-border border-y border-border p-0">
          {runs.map((run) => {
            const selected = run.id === selectedRunId;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(run.id)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] font-semibold" title={run.id}>
                      {run.id}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {run.state} · attempt {run.attempt}
                    </span>
                  </span>
                  <span
                    className="shrink-0 font-mono text-[11px] text-muted-foreground"
                    title={run.updatedAt}
                  >
                    {formatEngagementTimestamp(run.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {history.hasNextPage ? (
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={!history.hasNextPage || history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? "Loading more" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    );

  return (
    <section aria-label="Run history">
      <h2 className="m-0 text-[13px] font-semibold">Run history</h2>
      <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
        Newest first. Selection stays where you put it.
      </p>
      <div className="mt-3">
        {history.isError ? (
          <StaleDataState
            title="Showing the last successful run history"
            description="The latest refresh failed. Existing runs are still available."
            onRetry={retryHistory}
          >
            {listBody}
          </StaleDataState>
        ) : (
          listBody
        )}
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <SelectedRunOutput engagementId={engagementId} selectedRunId={selectedRunId} />
      </div>
    </section>
  );
}

function SelectedRunOutput({
  engagementId,
  selectedRunId,
}: {
  engagementId: string;
  selectedRunId: string | undefined;
}) {
  const output = useRunOutputQuery(engagementId, selectedRunId);
  const hasOutputData = output.data !== undefined;
  const retryOutput = () => void output.refetch();

  if (selectedRunId === undefined || selectedRunId.length === 0) {
    return (
      <section aria-label="Selected run output">
        <h3 className="m-0 text-[13px] font-semibold">Selected run output</h3>
        <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
          Select a run to view its exact preserved output.
        </p>
      </section>
    );
  }

  if (!hasOutputData && output.isFetching) {
    return (
      <section aria-label="Selected run output">
        <h3 className="m-0 text-[13px] font-semibold">Selected run output</h3>
        <LoadingRegion label="Loading selected run output" className="mt-3 space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-24 w-full" />
        </LoadingRegion>
      </section>
    );
  }

  if (!hasOutputData && output.error instanceof RunNotFoundError) {
    return (
      <section aria-label="Selected run output">
        <h3 className="m-0 text-[13px] font-semibold">Selected run output</h3>
        <div className="mt-3">
          <RecoverableError
            title="Run unavailable"
            description="That run is no longer available. Pick another run from the history."
            onRetry={retryOutput}
          />
        </div>
      </section>
    );
  }

  if (!hasOutputData && output.isError) {
    return (
      <section aria-label="Selected run output">
        <h3 className="m-0 text-[13px] font-semibold">Selected run output</h3>
        <div className="mt-3">
          <RecoverableError
            title="Selected output unavailable"
            description="Preserved output for the selected run could not be loaded from the local control plane."
            onRetry={retryOutput}
          />
        </div>
      </section>
    );
  }

  if (!hasOutputData) {
    return (
      <section aria-label="Selected run output">
        <h3 className="m-0 text-[13px] font-semibold">Selected run output</h3>
        <LoadingRegion label="Loading selected run output" className="mt-3 space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-24 w-full" />
        </LoadingRegion>
      </section>
    );
  }

  const content = <SelectedRunContent output={output.data} onRefresh={retryOutput} />;
  if (output.isError) {
    return (
      <StaleDataState
        title="Showing the last successful output"
        description="The latest refresh failed. Existing output is still available."
        onRetry={retryOutput}
      >
        {content}
      </StaleDataState>
    );
  }
  return content;
}

function SelectedRunContent({
  onRefresh,
  output,
}: {
  onRefresh: () => void;
  output: RunOutputResponse;
}) {
  return (
    <section aria-label="Selected run output">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[13px] font-semibold">
          Selected run output{" "}
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            {output.run.id} · {output.run.state}
          </span>
        </h3>
        <Button
          type="button"
          variant="quiet"
          className="h-7 px-2 text-[12px]"
          onClick={onRefresh}
        >
          Refresh
        </Button>
      </div>
      <div className="mt-3 grid gap-3">
        <SelectedRunStream label="stdout" runId={output.run.id} stream={output.stdout} />
        <SelectedRunStream label="stderr" runId={output.run.id} stream={output.stderr} />
      </div>
    </section>
  );
}

// Minimal selected-run stream view. Mirrors the accessible shape of the
// established raw output renderer without importing its unexported internals
// (this slice must not edit shared output files). See handoff for the gap.
function SelectedRunStream({
  label,
  runId,
  stream,
}: {
  label: "stdout" | "stderr";
  runId: string;
  stream: RunOutputResponse["stdout"];
}) {
  if (!stream.present) {
    return (
      <section aria-label={`${label} for run ${runId}`}>
        <h4 className="m-0 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">
          {label}
        </h4>
        <p className="mt-1 mb-0 text-[12px] text-muted-foreground">
          No preserved {label} for this run.
        </p>
      </section>
    );
  }
  return (
    <section aria-label={`${label} for run ${runId}`}>
      <h4 className="m-0 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </h4>
      {stream.truncated ? (
        <p className="mt-1 mb-0 text-[11px] text-muted-foreground">
          Truncated to the first 65536 bytes of {stream.sizeBytes} bytes.
        </p>
      ) : null}
      <pre
        className="mt-1 mb-0 max-h-64 overflow-auto rounded-md border border-border bg-muted/30 px-2.5 py-2 font-mono text-[12px] leading-5 break-all whitespace-pre-wrap"
        data-testid={`run-history-${label}`}
      >
        {stream.content}
      </pre>
    </section>
  );
}
