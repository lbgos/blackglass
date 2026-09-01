import type { Engagement } from "@blackglass/contracts";
import {
  Button,
  EmptyState,
  LoadingRegion,
  RecoverableError,
  Skeleton,
  StaleDataState,
} from "@blackglass/ui";
import { Link } from "@tanstack/react-router";

import {
  ENGAGEMENT_KIND_LABELS,
  ENGAGEMENT_STATUS_LABELS,
  formatEngagementTimestamp,
} from "./format.js";
import { partitionEngagements, useEngagementDetailQuery, useEngagementsQuery } from "./query.js";
import { ActionPlanner } from "./action-planner.js";
import { SavedScopeEditor } from "./scope-editor.js";
import { EngagementServicesSection } from "./service-surface.js";
import { useEngagementWorkspace } from "./workspace-context.js";

const NEXT_SURFACES = [
  {
    title: "Evidence",
    detail: "Inspect captured output and services from completed work. Not connected yet.",
  },
  {
    title: "Findings",
    detail: "Promote observations into findings for the report. Not connected yet.",
  },
  {
    title: "Notes",
    detail: "Operator notes stay with this engagement. Not connected yet.",
  },
  {
    title: "Report",
    detail: "Assemble findings and evidence into a report. Not connected yet.",
  },
] as const;

export function EngagementWorkspace({ engagementId }: { engagementId?: string }) {
  const engagements = useEngagementsQuery();
  const { openCreate } = useEngagementWorkspace();
  const hasData = engagements.data !== undefined;
  const retry = () => void engagements.refetch();

  if (!hasData && engagements.isFetching) {
    return (
      <main className="min-h-full bg-background px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="m-0 text-[26px] leading-none font-semibold tracking-[-0.04em]">
            Engagements
          </h1>
          <LoadingRegion label="Loading engagements" className="mt-5 space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-56 max-w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </LoadingRegion>
        </div>
      </main>
    );
  }

  if (!hasData && engagements.isError) {
    return (
      <main className="min-h-full bg-background px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="mb-5 text-[26px] leading-none font-semibold tracking-[-0.04em]">
            Engagements
          </h1>
          <RecoverableError
            variant="page"
            title="Engagements unavailable"
            description="The engagement list could not be loaded from the local control plane."
            onRetry={retry}
          />
        </div>
      </main>
    );
  }

  const records = engagements.data ?? [];
  const selected = engagementId
    ? records.find((engagement) => engagement.id === engagementId)
    : undefined;

  if (engagementId !== undefined && selected === undefined) {
    return (
      <main className="min-h-full bg-background px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <RecoverableError
            variant="page"
            title="Engagement not found"
            description="That engagement is not in the current list. Refresh the list or open Engagements."
            onRetry={retry}
            retryLabel="Refresh list"
          />
          <p className="mt-4 mb-0">
            <Link
              to="/engagements"
              className="inline-flex min-h-11 items-center text-[13px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open Engagements
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const body =
    selected !== undefined ? (
      <EngagementDetail engagement={selected} />
    ) : records.length === 0 ? (
      <div>
        <h1 className="mb-5 text-[26px] leading-none font-semibold tracking-[-0.04em]">
          Engagements
        </h1>
        <EmptyState
          variant="primary"
          title="No engagements yet"
          description="Create an engagement to start local CTF, lab, or assessment work."
          action={<Button onClick={openCreate}>New engagement</Button>}
        />
      </div>
    ) : (
      <EngagementIndex engagements={records} />
    );

  const isDetail = selected !== undefined;
  const containerClass = isDetail ? "mx-auto w-full max-w-none" : "mx-auto w-full max-w-3xl";

  return (
    <main className="min-h-full bg-background px-4 py-5 sm:px-6">
      <div className={containerClass}>
        {engagements.isError ? (
          <StaleDataState
            title="Showing the last successful engagement list"
            description="The latest refresh failed. Existing engagements are still available."
            onRetry={retry}
          >
            {body}
          </StaleDataState>
        ) : (
          body
        )}
      </div>
    </main>
  );
}

function EngagementIndex({ engagements }: { engagements: readonly Engagement[] }) {
  const { active, archived } = partitionEngagements(engagements);
  return (
    <div>
      <header className="mb-5">
        <h1 className="m-0 text-[26px] leading-none font-semibold tracking-[-0.04em]">
          Engagements
        </h1>
        <p className="mt-2 mb-0 max-w-xl text-[13px] leading-5 text-muted-foreground">
          Active and archived engagements from the local control plane.
        </p>
      </header>
      {active.length > 0 && (
        <section className="grid gap-1" aria-label="Active engagements">
          {active.map((engagement) => (
            <EngagementSummaryLink key={engagement.id} engagement={engagement} />
          ))}
        </section>
      )}
      {active.length === 0 && (
        <EmptyState
          variant="filtered"
          title="No active engagements"
          description="Archived engagements stay available below. Reopen one or create a new engagement."
        />
      )}
      {archived.length > 0 && (
        <section className="mt-6" aria-label="Archived engagements">
          <h2 className="m-0 text-[11px] font-medium text-muted-foreground">Archived</h2>
          <div className="mt-2 grid gap-1">
            {archived.map((engagement) => (
              <EngagementSummaryLink key={engagement.id} engagement={engagement} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EngagementSummaryLink({ engagement }: { engagement: Engagement }) {
  return (
    <Link
      to="/engagements/$engagementId"
      params={{ engagementId: engagement.id }}
      className="surface-row flex min-h-14 items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold tracking-[-0.02em]">
          {engagement.name}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {ENGAGEMENT_KIND_LABELS[engagement.kind]} · {ENGAGEMENT_STATUS_LABELS[engagement.status]}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        rev {engagement.revision}
      </span>
    </Link>
  );
}

function selectDisplayedEngagement(listed: Engagement, detailed: Engagement | undefined): Engagement {
  if (detailed === undefined) return listed;
  return detailed.revision >= listed.revision ? detailed : listed;
}

function EngagementDetail({ engagement }: { engagement: Engagement }) {
  const { announce } = useEngagementWorkspace();
  const detail = useEngagementDetailQuery(engagement.id);
  const displayed = selectDisplayedEngagement(engagement, detail.data?.engagement);

  return (
    <article className="min-w-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            {ENGAGEMENT_KIND_LABELS[displayed.kind]}
          </p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.04em] leading-none">
            {displayed.name}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span aria-label={`Status: ${ENGAGEMENT_STATUS_LABELS[displayed.status]}`}>
              {ENGAGEMENT_STATUS_LABELS[displayed.status]}
            </span>
            <span className="text-border" aria-hidden="true">
              ·
            </span>
            <span className="font-mono">rev {displayed.revision}</span>
            <span className="text-border" aria-hidden="true">
              ·
            </span>
            <span>{displayed.kind}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="m-0 text-[11px] text-muted-foreground">Updated</p>
          <p className="m-0 font-mono text-[11px] text-foreground">
            {formatEngagementTimestamp(displayed.updatedAt)}
          </p>
        </div>
      </header>

      <div className="mt-5">
        <EngagementServicesSection engagementId={displayed.id} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ActionPlanner archived={displayed.status === "archived"} engagementId={displayed.id} />
        <SavedScopeEditor archived={displayed.status === "archived"} engagementId={displayed.id} />
      </div>

      <div className="mt-6 grid gap-6 border-t border-border pt-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <dl className="grid gap-3 text-[13px]">
          <Detail term="Description" value={displayed.description ?? "None"} />
          <Detail term="Authorization context" value={displayed.authorizationContext ?? "None"} />
          <Detail term="Auto-continue warnings" value={displayed.autoContinueWarnings ? "On" : "Off"} />
          <Detail term="Created" value={formatEngagementTimestamp(displayed.createdAt)} />
          <Detail term="Updated" value={formatEngagementTimestamp(displayed.updatedAt)} />
        </dl>
        <section aria-label="Next in this engagement">
          <h2 className="m-0 px-1 text-[13px] font-semibold">Next in this engagement</h2>
          <ul className="mt-2 mb-0 list-none p-0">
            {NEXT_SURFACES.map((surface) => (
              <li key={surface.title}>
                <button
                  type="button"
                  className="surface-row flex min-h-11 w-full flex-col items-start justify-center rounded-[10px] px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-8"
                  onClick={() => announce("Not connected yet")}
                >
                  <span className="text-[13px] font-semibold">{surface.title}</span>
                  <span className="mt-0.5 text-[12px] text-muted-foreground">{surface.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="m-0 text-[11px] text-muted-foreground">{term}</dt>
      <dd className="mt-1 mb-0 whitespace-pre-wrap text-foreground">{value}</dd>
    </div>
  );
}
