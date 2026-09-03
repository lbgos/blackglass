import type { RunOutputResponse } from "@blackglass/contracts";
import { Button, LoadingRegion, RecoverableError, Skeleton } from "@blackglass/ui";
import { useRouterState } from "@tanstack/react-router";

import {
  NoTerminalRunError,
  selectEngagementIdFromPathname,
  useLatestRunOutputQuery,
} from "./run-output-query.js";

export function RawOutputPanel() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const engagementId = selectEngagementIdFromPathname(pathname);
  if (engagementId === undefined) {
    return (
      <div>
        <p className="m-0 text-[13px] font-semibold">Raw output</p>
        <p className="mt-1 mb-0 text-[13px] text-muted-foreground">
          Open an engagement to view preserved raw output.
        </p>
      </div>
    );
  }
  return <RawOutputBody engagementId={engagementId} />;
}

function RawOutputBody({ engagementId }: { engagementId: string }) {
  const query = useLatestRunOutputQuery(engagementId);
  const retry = () => void query.refetch();
  const hasData = query.data !== undefined;

  if (!hasData && query.isFetching) {
    return (
      <LoadingRegion label="Loading raw output" className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-24 w-full" />
      </LoadingRegion>
    );
  }
  if (!hasData && query.error instanceof NoTerminalRunError) {
    return (
      <div>
        <p className="m-0 text-[13px] font-semibold">Raw output</p>
        <p className="mt-1 mb-0 text-[13px] text-muted-foreground">
          No finished or cancelled runs yet. Queue an action to produce preserved output.
        </p>
      </div>
    );
  }
  if (!hasData && query.isError) {
    return (
      <RecoverableError
        title="Raw output unavailable"
        description="Preserved raw output could not be loaded from the local control plane."
        onRetry={retry}
      />
    );
  }
  if (!hasData) {
    return (
      <LoadingRegion label="Loading raw output" className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-24 w-full" />
      </LoadingRegion>
    );
  }
  return <RawOutputContent output={query.data} onRefresh={retry} />;
}

function RawOutputContent({
  output,
  onRefresh,
}: {
  output: RunOutputResponse;
  onRefresh: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold">
          Raw output{" "}
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            {output.run.id} · {output.run.state}
          </span>
        </p>
        <Button type="button" variant="quiet" className="h-7 px-2 text-[12px]" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <RawStream label="stdout" stream={output.stdout} runId={output.run.id} />
      <RawStream label="stderr" stream={output.stderr} runId={output.run.id} />
    </div>
  );
}

function RawStream({
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
        <h3 className="m-0 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">
          {label}
        </h3>
        <p className="mt-1 mb-0 text-[12px] text-muted-foreground">
          No preserved {label} for this run.
        </p>
      </section>
    );
  }
  return (
    <section aria-label={`${label} for run ${runId}`}>
      <h3 className="m-0 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </h3>
      {stream.truncated ? (
        <p className="mt-1 mb-0 text-[11px] text-muted-foreground">
          Truncated to the first 65536 bytes of {stream.sizeBytes} bytes.
        </p>
      ) : null}
      <pre
        className="mt-1 mb-0 max-h-64 overflow-auto rounded-md border border-border bg-muted/30 px-2.5 py-2 font-mono text-[12px] leading-5 break-all whitespace-pre-wrap"
        data-testid={`raw-output-${label}`}
      >
        {stream.content}
      </pre>
    </section>
  );
}
