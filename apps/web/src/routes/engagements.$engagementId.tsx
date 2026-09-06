import { createFileRoute } from "@tanstack/react-router";

import { EngagementWorkspace } from "../engagements/workspace.js";

// Engagement detail search. Raw strings pass through; the workspace resolves
// an unknown tab to the surface default and forwards the run id only through
// the existing encoded run-output query (no latest-run fallback).
export function validateEngagementSearch(search: Record<string, unknown>): {
  tab?: string;
  run?: string;
} {
  const result: { tab?: string; run?: string } = {};
  if (typeof search.tab === "string") result.tab = search.tab;
  if (typeof search.run === "string") result.run = search.run;
  return result;
}

export const Route = createFileRoute("/engagements/$engagementId")({
  validateSearch: validateEngagementSearch,
  component: EngagementDetailPage,
});

function EngagementDetailPage() {
  const { engagementId } = Route.useParams();
  const { run, tab } = Route.useSearch();
  return <EngagementWorkspace engagementId={engagementId} tab={tab} selectedRunId={run} />;
}
