import { useState } from "react";

import type { Finding } from "@blackglass/contracts";
import {
  Button,
  LoadingRegion,
  RecoverableError,
  Skeleton,
  StaleDataState,
} from "@blackglass/ui";

import { findingMutationMessage } from "./errors.js";
import {
  useCreateFindingMutation,
  useFindingTransitionMutation,
  useFindingsQuery,
} from "./findings-query.js";
import { formatEngagementTimestamp } from "./format.js";

const SEVERITY_OPTIONS = ["info", "low", "medium", "high", "critical"] as const;

function parseEvidenceInput(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function EngagementFindingsSection({
  archived,
  engagementId,
}: {
  archived: boolean;
  engagementId: string;
}) {
  const findings = useFindingsQuery(engagementId);
  const retry = () => void findings.refetch();
  const hasData = findings.data !== undefined;

  const body = <FindingsBody archived={archived} engagementId={engagementId} />;

  return (
    <section aria-label="Findings" className="mt-5 border-t border-border pt-4">
      <header className="mb-3">
        <h2 className="m-0 text-[13px] font-semibold">Findings</h2>
        <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
          Compact finding list for CTF reporting. Create, resolve, and reopen per engagement.
        </p>
      </header>
      {!hasData && findings.isFetching ? (
        <LoadingRegion label="Loading findings" className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </LoadingRegion>
      ) : null}
      {!hasData && findings.isError ? (
        <RecoverableError
          title="Findings unavailable"
          description="The findings could not be loaded from the local control plane."
          onRetry={retry}
        />
      ) : null}
      {hasData && findings.isError ? (
        <StaleDataState
          title="Showing the last successful findings"
          description="The latest refresh failed. Existing findings are still available."
          onRetry={retry}
        >
          {body}
        </StaleDataState>
      ) : null}
      {hasData && !findings.isError ? body : null}
    </section>
  );
}

function FindingsBody({
  archived,
  engagementId,
}: {
  archived: boolean;
  engagementId: string;
}) {
  const findings = useFindingsQuery(engagementId);
  const create = useCreateFindingMutation(engagementId);
  const resolve = useFindingTransitionMutation(engagementId, "resolve");
  const reopen = useFindingTransitionMutation(engagementId, "reopen");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] =
    useState<(typeof SEVERITY_OPTIONS)[number]>("medium");
  const [body, setBody] = useState("");
  const [evidence, setEvidence] = useState("");
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const records = findings.data ?? [];
  const openCount = records.filter((finding) => finding.status === "open").length;
  const mutationError =
    create.isError || resolve.isError || reopen.isError
      ? findingMutationMessage(
          create.error ?? resolve.error ?? reopen.error,
        )
      : formError;

  const canSubmit =
    !archived && !create.isPending && title.trim().length > 0;

  const submit = () => {
    setFormError(undefined);
    if (create.isError) create.reset();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setFormError("Enter a finding title.");
      return;
    }
    create.mutate(
      {
        title: trimmedTitle,
        severity,
        body,
        evidenceArtifactIds: parseEvidenceInput(evidence),
      },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          setEvidence("");
          setSeverity("medium");
        },
      },
    );
  };

  return (
    <div className="grid gap-4">
      <div>
        {records.length === 0 ? (
          <div className="rounded-[10px] border border-border px-4 py-8 text-center">
            <h3 className="m-0 text-[13px] font-semibold">No findings yet</h3>
            <p className="mx-auto mt-2 mb-0 max-w-md text-[13px] leading-5 text-muted-foreground">
              Record the first finding for this engagement with a title, severity, and notes.
            </p>
          </div>
        ) : (
          <div>
            <p className="m-0 mb-2 text-[12px] text-muted-foreground" aria-live="polite">
              {openCount} open of {records.length} findings
            </p>
            <ul className="m-0 grid list-none gap-2 p-0">
              {records.map((finding) => (
                <FindingRow
                  key={finding.id}
                  archived={archived}
                  finding={finding}
                  pending={resolve.isPending || reopen.isPending}
                  onResolve={() => {
                    if (resolve.isError) resolve.reset();
                    if (reopen.isError) reopen.reset();
                    resolve.mutate(finding.id);
                  }}
                  onReopen={() => {
                    if (resolve.isError) resolve.reset();
                    if (reopen.isError) reopen.reset();
                    reopen.mutate(finding.id);
                  }}
                />
              ))}
            </ul>
          </div>
        )}
        {mutationError ? (
          <p className="mt-2 mb-0 text-[13px] text-destructive" role="alert">
            {mutationError}
          </p>
        ) : null}
      </div>

      <div className="rounded-[10px] border border-border">
        <div className="border-b border-border px-3 py-2">
          <h3 className="m-0 text-[13px] font-semibold">New finding</h3>
        </div>
        <div className="grid gap-3 px-3 py-3">
          <label className="grid gap-1 text-[11px] text-muted-foreground" htmlFor="finding-title">
            <span>Title</span>
            <input
              id="finding-title"
              value={title}
              disabled={archived || create.isPending}
              placeholder="Default credentials on admin panel"
              maxLength={120}
              className="w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] text-muted-foreground" htmlFor="finding-severity">
              <span>Severity</span>
              <select
                id="finding-severity"
                value={severity}
                disabled={archived || create.isPending}
                className="w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) =>
                  setSeverity(event.target.value as typeof severity)
                }
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] text-muted-foreground" htmlFor="finding-evidence">
              <span>Evidence artifact ids, comma separated</span>
              <input
                id="finding-evidence"
                value={evidence}
                disabled={archived || create.isPending}
                placeholder="nmap-xml-1"
                spellCheck={false}
                className="w-full rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setEvidence(event.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-1 text-[11px] text-muted-foreground" htmlFor="finding-body">
            <span>Notes Markdown</span>
            <textarea
              id="finding-body"
              value={body}
              rows={5}
              disabled={archived || create.isPending}
              placeholder="# impact&#10;# remediation"
              spellCheck={false}
              className="min-h-24 w-full rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          {archived ? (
            <p className="m-0 text-[12px] leading-5 text-muted-foreground">
              This engagement is archived. Findings can be viewed but not changed.
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
            >
              {create.isPending ? "Saving" : "Create finding"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FindingRow({
  archived,
  finding,
  pending,
  onResolve,
  onReopen,
}: {
  archived: boolean;
  finding: Finding;
  pending: boolean;
  onResolve: () => void;
  onReopen: () => void;
}) {
  const isOpen = finding.status === "open";
  return (
    <li className="rounded-[10px] border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[13px] font-semibold" title={finding.title}>
            {finding.title}
          </p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span>{finding.severity}</span>
            <span aria-hidden="true">·</span>
            <span>{finding.status}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{formatEngagementTimestamp(finding.updatedAt)}</span>
            {finding.evidenceArtifactIds.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">
                  {finding.evidenceArtifactIds.length} evidence
                </span>
              </>
            ) : null}
          </p>
        </div>
        {isOpen ? (
          <Button
            type="button"
            variant="secondary"
            disabled={archived || pending}
            onClick={onResolve}
          >
            Resolve
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={archived || pending}
            onClick={onReopen}
          >
            Reopen
          </Button>
        )}
      </div>
      {finding.body.length > 0 ? (
        <p className="m-0 mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-muted-foreground">
          {finding.body}
        </p>
      ) : null}
      {finding.evidenceArtifactIds.length > 0 ? (
        <p className="m-0 mt-1 truncate font-mono text-[11px] text-muted-foreground" title={finding.evidenceArtifactIds.join(", ")}>
          {finding.evidenceArtifactIds.join(", ")}
        </p>
      ) : null}
    </li>
  );
}
