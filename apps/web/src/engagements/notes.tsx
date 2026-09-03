import { Button, LoadingRegion, RecoverableError, Skeleton, StaleDataState } from "@blackglass/ui";

import { engagementMutationMessage } from "./errors.js";
import { useEngagementNotesEditor } from "./notes-query.js";

export function EngagementNotesSection({
  archived,
  engagementId,
}: {
  archived: boolean;
  engagementId: string;
}) {
  const { query, save, value, dirty, setDraft } = useEngagementNotesEditor(engagementId);
  const retry = () => void query.refetch();
  const hasData = query.data !== undefined;
  const body = (
    <NotesEditorBody
      archived={archived}
      value={value}
      dirty={dirty}
      pending={save.isPending}
      error={save.isError ? engagementMutationMessage(save.error) : undefined}
      onChange={(next) => {
        setDraft(next);
        if (save.isError) save.reset();
      }}
      onSave={() => save.mutate(value)}
    />
  );

  return (
    <section aria-label="Engagement notes" className="mt-5 border-t border-border pt-4">
      <header className="mb-3">
        <h2 className="m-0 text-[13px] font-semibold">Notes</h2>
        <p className="mt-1 mb-0 text-[12px] leading-5 text-muted-foreground">
          One Markdown scratchpad per engagement for creds, flags, and observations.
        </p>
      </header>
      {!hasData && query.isFetching ? (
        <LoadingRegion label="Loading notes" className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-32 w-full" />
        </LoadingRegion>
      ) : null}
      {!hasData && query.isError ? (
        <RecoverableError
          title="Notes unavailable"
          description="The engagement notes could not be loaded from the local control plane."
          onRetry={retry}
        />
      ) : null}
      {hasData && query.isError ? (
        <StaleDataState
          title="Showing the last successful notes"
          description="The latest refresh failed. Existing notes are still available."
          onRetry={retry}
        >
          {body}
        </StaleDataState>
      ) : null}
      {hasData && !query.isError ? body : null}
    </section>
  );
}

function NotesEditorBody({
  archived,
  value,
  dirty,
  pending,
  error,
  onChange,
  onSave,
}: {
  archived: boolean;
  value: string;
  dirty: boolean;
  pending: boolean;
  error: string | undefined;
  onChange: (next: string) => void;
  onSave: () => void;
}) {
  return (
    <div>
      <label className="grid gap-1 text-[11px] text-muted-foreground" htmlFor="engagement-notes-editor">
        <span>Markdown</span>
        <textarea
          id="engagement-notes-editor"
          value={value}
          rows={10}
          disabled={archived || pending}
          placeholder={"# creds\n# flags\n# observations"}
          spellCheck={false}
          className="min-h-32 w-full rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {archived ? (
        <p className="mt-3 mb-0 text-[12px] leading-5 text-muted-foreground">
          This engagement is archived. Notes can be viewed but not changed.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 mb-0 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[12px] text-muted-foreground" aria-live="polite">
          {pending ? "Saving" : dirty ? "Unsaved changes" : "Saved"}
        </p>
        <Button type="button" disabled={archived || !dirty || pending} onClick={onSave}>
          {pending ? "Saving" : "Save notes"}
        </Button>
      </div>
    </div>
  );
}
