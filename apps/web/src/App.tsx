import { ApplicationShell, Button, Status, type ConsolePanel } from "@blackglass/ui";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { CreateEngagementDialog } from "./engagements/create-dialog.js";
import { EngagementSidebarList } from "./engagements/sidebar.js";
import {
  EngagementWorkspaceProvider,
  useEngagementWorkspace,
} from "./engagements/workspace-context.js";
import { partitionEngagements, useEngagementsQuery } from "./engagements/query.js";
import { SettingsBackButton, SettingsNav } from "./settings/sidebar.js";
import { SettingsViewProvider } from "./settings/settings-view.js";
import { StageHeader } from "./stage-header.js";
import { useSystemStatusQuery } from "./system-status-query.js";

const navigationLinks = [
  { label: "Dashboard", to: "/" },
  { label: "Engagements", to: "/engagements" },
] as const;

const consolePanels: readonly ConsolePanel[] = [
  {
    value: "advisor",
    label: "Advisor",
    content: (
      <ConsolePlaceholder
        title="Advisor"
        detail="Ask from the current engagement when the advisor is connected. Guidance is not available yet."
      />
    ),
  },
  {
    value: "activity",
    label: "Activity",
    content: (
      <ConsolePlaceholder
        title="Activity"
        detail="Queue, run, cancel, and retry events will appear here. No runs are connected yet."
      />
    ),
  },
  {
    value: "raw-output",
    label: "Raw output",
    content: (
      <ConsolePlaceholder
        title="Raw output"
        detail="Live tool output will stream here for the current run. Raw output is not available yet."
      />
    ),
  },
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.4 10.4 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ConsolePlaceholder({ detail, title }: { detail: string; title: string }) {
  return (
    <div>
      <p className="m-0 text-[13px] font-semibold">{title}</p>
      <p className="mt-1 mb-0 text-[13px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function SidebarHeader() {
  const systemStatus = useSystemStatusQuery();
  const ready = systemStatus.data?.overall === "ready";
  const badge = !systemStatus.data
    ? systemStatus.isError
      ? "Offline"
      : "Checking"
    : ready
      ? "Ready"
      : "Not ready";

  return (
    <div className="flex h-12 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]">
      <span className="size-3.5 shrink-0 rounded-[4px] bg-primary" aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.03em] text-sidebar-foreground">
        BLACKGLASS
      </p>
      <span className="shrink-0 font-mono text-[10px] tracking-wide text-sidebar-muted-foreground uppercase">
        {badge}
      </span>
    </div>
  );
}

function SidebarActions({
  onCreate,
  onNavigate,
}: {
  onCreate: () => void;
  onNavigate: () => void;
}) {
  const { engagementFilter, setEngagementFilter } = useEngagementWorkspace();

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sidebar-muted-foreground focus-within:bg-sidebar-hover md:min-h-8">
        <SearchIcon />
        <span className="sr-only">Filter engagements</span>
        <input
          type="search"
          value={engagementFilter}
          placeholder="Filter engagements"
          aria-label="Filter engagements"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setEngagementFilter(event.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label="New engagement"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-8"
        onClick={() => {
          onNavigate();
          onCreate();
        }}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function SidebarNavigation({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div>
      <nav aria-label="Global" className="px-2 pt-1 pb-2">
        <ul className="m-0 list-none space-y-0.5 p-0">
          {navigationLinks.map((link) => (
            <li key={link.label}>
              <Link
                to={link.to}
                activeOptions={{ exact: link.to !== "/engagements" }}
                activeProps={{
                  className: "bg-sidebar-active text-sidebar-foreground",
                }}
                className="flex min-h-11 items-center rounded-md px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
                inactiveProps={{
                  className:
                    "text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground",
                }}
                onClick={onNavigate}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <EngagementSidebarList onNavigate={onNavigate} />
    </div>
  );
}

function PluginsIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-[15px] shrink-0" aria-hidden="true">
      <path d="M4.2 5.2h7.6v7.2H4.2z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 5.2V3.8h4v1.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-[15px] shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M12.1 3.9l-1 1M4.9 11.1l-1 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

const footerLinkClasses =
  "flex min-h-11 items-center gap-2 rounded-lg px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8";

function SidebarFooter({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-2.5">
      <Link
        to="/plugins"
        activeProps={{ className: `${footerLinkClasses} bg-sidebar-active text-sidebar-foreground` }}
        className={`${footerLinkClasses} text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground`}
        onClick={onNavigate}
      >
        <PluginsIcon />
        Plugins
      </Link>
      <Link
        to="/settings"
        activeOptions={{ exact: true }}
        activeProps={{ className: `${footerLinkClasses} bg-sidebar-active text-sidebar-foreground` }}
        className={`${footerLinkClasses} text-sidebar-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground`}
        onClick={onNavigate}
      >
        <SettingsIcon />
        Settings
      </Link>
    </div>
  );
}

function WorkspaceNotice() {
  const { notice } = useEngagementWorkspace();
  return (
    <p
      className={
        notice
          ? "border-b border-border px-4 py-2 text-[13px] text-muted-foreground"
          : "sr-only"
      }
      data-testid="workspace-notice"
      role="status"
    >
      {notice ?? ""}
    </p>
  );
}

function consoleStatusLabel(systemStatus: ReturnType<typeof useSystemStatusQuery>): string {
  if (systemStatus.data?.overall === "ready") return "No active runs · System ready";
  if (systemStatus.data) return "No active runs · System not ready";
  if (systemStatus.isError) return "No active runs · System unavailable";
  return "No active runs";
}

export function ApplicationLayout() {
  const [createOpen, setCreateOpen] = useState(false);
  const openCreate = () => setCreateOpen(true);
  const systemStatus = useSystemStatusQuery();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const onSettings = pathname === "/settings";
  const onPlugins = pathname === "/plugins";
  // Reference chrome visibility: Settings drops the desktop stage header and
  // console; Plugins keeps the header but drops the console; other routes keep both.
  const showConsole = !onSettings && !onPlugins;
  const showDesktopStageHeader = !onSettings;
  // The settings Back control returns to the last non-settings route, which also
  // covers direct /settings entry where no internal route was visited yet.
  const returnPath = useRef("/");
  useEffect(() => {
    if (!onSettings) returnPath.current = pathname;
  }, [onSettings, pathname]);
  const goBackFromSettings = () => {
    void navigate({ to: returnPath.current });
  };

  return (
    <EngagementWorkspaceProvider openCreate={openCreate}>
      <SettingsViewProvider active={onSettings}>
        <ApplicationShell
          consolePanels={consolePanels}
          consoleStatus={consoleStatusLabel(systemStatus)}
          showConsole={showConsole}
          showDesktopStageHeader={showDesktopStageHeader}
          sidebarActions={
            onSettings
              ? undefined
              : (closeMobile) => <SidebarActions onCreate={openCreate} onNavigate={closeMobile} />
          }
          sidebarContent={(closeMobile) =>
            onSettings ? (
              <SettingsNav onCloseMobile={closeMobile} />
            ) : (
              <SidebarNavigation onNavigate={closeMobile} />
            )
          }
          sidebarFooter={(closeMobile) =>
            onSettings ? (
              <div className="px-2 pb-2.5">
                <SettingsBackButton onBack={goBackFromSettings} onCloseMobile={closeMobile} />
              </div>
            ) : (
              <SidebarFooter onNavigate={closeMobile} />
            )
          }
          sidebarHeader={<SidebarHeader />}
          stageHeader={<StageHeader />}
        >
          <WorkspaceNotice />
          <Outlet />
        </ApplicationShell>
        <CreateEngagementDialog open={createOpen} onOpenChange={setCreateOpen} />
      </SettingsViewProvider>
    </EngagementWorkspaceProvider>
  );
}

export function DashboardPage() {
  const systemStatus = useSystemStatusQuery();
  const { openCreate } = useEngagementWorkspace();
  const engagements = useEngagementsQuery();
  const hasSystemStatus = systemStatus.data !== undefined;
  const retrySystemStatus = () => void systemStatus.refetch();
  const records = engagements.data ?? [];
  const { active } = partitionEngagements(records);
  const recent = mostRecentlyUpdated(active) ?? mostRecentlyUpdated(records);

  return (
    <main className="min-h-full bg-background px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5">
          <h1 className="mt-0 mb-0 text-[26px] leading-none font-semibold tracking-[-0.04em]">
            Workspace
          </h1>
          <p className="mt-2 mb-0 max-w-xl text-[13px] leading-5 text-muted-foreground">
            Local control-plane status and the current engagement. Runner, advisor, and report
            surfaces stay unavailable until they exist.
          </p>
        </header>

        <section className="rounded-[10px] border border-border bg-card px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="m-0 text-[13px] font-semibold">Control plane</h2>
            <Button variant="quiet" onClick={retrySystemStatus}>
              Check again
            </Button>
          </div>

          {!hasSystemStatus && systemStatus.isFetching && (
            <Status
              loading
              title="Checking system"
              detail="Waiting for the local runtime status."
            />
          )}
          {hasSystemStatus && !systemStatus.isError && (
            <Status
              tone={systemStatus.data.overall === "ready" ? "success" : "warning"}
              title={systemStatus.data.overall === "ready" ? "System ready" : "System not ready"}
              detail={
                systemStatus.data.developmentStorage === "ready"
                  ? "Control plane and development storage are ready."
                  : "Development storage is not ready."
              }
            />
          )}
          {hasSystemStatus && systemStatus.isError && (
            <Status
              tone="warning"
              title={`Last known: system ${systemStatus.data.overall === "ready" ? "ready" : "not ready"}`}
              detail="Status refresh failed. Showing the last-known system and development storage state."
              action={<Button onClick={retrySystemStatus}>Retry</Button>}
            />
          )}
          {!hasSystemStatus && systemStatus.isError && !systemStatus.isFetching && (
            <Status
              tone="warning"
              title="System unavailable"
              detail="No valid runtime status was received."
              action={<Button onClick={retrySystemStatus}>Retry</Button>}
            />
          )}
        </section>

        {recent ? (
          <section className="mt-4 rounded-[10px] border border-border bg-card px-4 py-4">
            <h2 className="m-0 text-[13px] font-semibold">Current engagement</h2>
            <p className="mt-2 mb-3 text-[13px] text-muted-foreground">
              Continue from the selected engagement.
            </p>
            <Link
              to="/engagements/$engagementId"
              params={{ engagementId: recent.id }}
              className="inline-flex min-h-11 items-center text-[13px] font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
            >
              {recent.name}
            </Link>
          </section>
        ) : (
          <section className="mt-4">
            <EmptyEngagementPrompt onCreate={openCreate} />
          </section>
        )}
      </div>
    </main>
  );
}

function mostRecentlyUpdated<T extends { id: string; updatedAt: string }>(
  engagements: readonly T[],
): T | undefined {
  return engagements.reduce<T | undefined>((current, engagement) => {
    if (!current) return engagement;
    if (engagement.updatedAt > current.updatedAt) return engagement;
    if (engagement.updatedAt === current.updatedAt && engagement.id > current.id) return engagement;
    return current;
  }, undefined);
}

function EmptyEngagementPrompt({ onCreate }: { onCreate: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] px-1 py-2">
      <p className="m-0 text-[13px] text-muted-foreground">
        Open Engagements to load records from the API, or create one here.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onCreate}>New engagement</Button>
        <Button
          variant="secondary"
          onClick={() => {
            void navigate({ to: "/engagements" });
          }}
        >
          View engagements
        </Button>
      </div>
    </div>
  );
}
