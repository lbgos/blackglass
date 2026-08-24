import {
  THEME_MEDIA_QUERY,
  THEME_FAMILIES,
  cn,
  listenForSystemTheme,
  resolveTheme,
  useTheme,
  type ResolvedTheme,
  type ThemeFamily,
  type ThemePreference,
} from "@blackglass/ui";
import { useEffect, useState, type ReactNode } from "react";

import { SETTINGS_SECTIONS, type SettingsSectionId } from "./model.js";
import { useSettingsView } from "./settings-view.js";
import { useSystemStatusQuery } from "../system-status-query.js";

const LOCKED_NOTE =
  "Saving preferences arrives with the v0.1 settings store. Values shown are shipped local defaults.";

function SetRow({
  children,
  description,
  settingId,
  title,
}: {
  children?: ReactNode;
  description?: string;
  settingId?: string;
  title: string;
}) {
  const { highlightId } = useSettingsView();
  const highlighted = settingId !== undefined && highlightId === settingId;
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-7 border-b border-border py-3.5 last:border-b-0",
        highlighted && "-mx-2 rounded-lg bg-sidebar-active px-2",
      )}
      id={settingId === undefined ? undefined : `setting-${settingId}`}
      tabIndex={settingId === undefined ? undefined : -1}
    >
      <div>
        <h3 className="m-0 text-[13px] font-medium">{title}</h3>
        {description && (
          <p className="mt-1 mb-0 max-w-[440px] text-xs leading-[1.45] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  label,
  locked = true,
}: {
  checked: boolean;
  label: string;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={locked || undefined}
      aria-label={label}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full p-0 transition-colors duration-100",
        checked ? "bg-primary" : "bg-foreground/15",
        locked && "cursor-default opacity-55",
      )}
    >
      <span
        className="absolute top-0.5 size-3.5 rounded-full bg-white"
        style={{ left: checked ? "16px" : "2px" }}
      />
    </button>
  );
}

interface FieldOption {
  label: string;
  value: string;
}

function SelectField({
  label,
  options,
  value,
}: {
  label: string;
  options: readonly FieldOption[];
  value: string;
}) {
  return (
    <select
      aria-label={label}
      disabled
      className="min-h-8 min-w-[148px] rounded-lg border border-border bg-accent px-2.5 text-[13px] text-foreground opacity-80"
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function PathField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <input
      aria-label={label}
      className="min-h-8 w-60 rounded-lg border border-border bg-accent px-2.5 font-mono text-xs text-muted-foreground"
      placeholder={placeholder}
      readOnly
      type="text"
    />
  );
}

function LockedButton({ label, reason }: { label: string; reason: string }) {
  return (
    <button
      type="button"
      aria-disabled="true"
      className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border px-3 text-[13px] text-muted-foreground opacity-60"
      title={reason}
    >
      {label}
    </button>
  );
}

function HealthStatus({
  detail,
  label,
  tone,
}: {
  detail: string;
  label: string;
  tone: "ok" | "warn" | "fail" | "neutral";
}) {
  const toneText = {
    ok: "text-success",
    warn: "text-warning",
    fail: "text-destructive",
    neutral: "text-muted-foreground",
  }[tone];
  const toneBg = {
    ok: "bg-success",
    warn: "bg-warning",
    fail: "bg-destructive",
    neutral: "bg-muted-foreground/50",
  }[tone];
  return (
    <span className="flex items-center justify-between gap-4">
      <span aria-label={`${label}: ${detail}`} className={cn("text-xs font-semibold", toneText)}>
        {detail}
      </span>
      <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", toneBg)} />
    </span>
  );
}

type SystemTone = "ok" | "warn" | "fail" | "neutral";

function systemTone(status: ReturnType<typeof useSystemStatusQuery>): SystemTone {
  if (!status.data) return status.isError || !status.isFetching ? "fail" : "neutral";
  return status.data.overall === "ready" ? "ok" : "warn";
}

function GeneralSection() {
  return (
    <>
      <SetRow
        description="Skip the warning dialog for this engagement and record each continue automatically."
        settingId="auto-continue"
        title="Auto-continue engagement warnings"
      >
        <ToggleSwitch checked={false} label="Auto-continue engagement warnings" />
      </SetRow>
      <SetRow
        description="System default follows the host clock. Used in tables, console, and history."
        settingId="timestamp-format"
        title="Timestamp format"
      >
        <SelectField
          label="Timestamp format"
          options={[
            { label: "System default", value: "locale" },
            { label: "12-hour", value: "12-hour" },
            { label: "24-hour", value: "24-hour" },
          ]}
          value="24-hour"
        />
      </SetRow>
      <SetRow
        description="Move reviewed actions out of the history tail after a set number of days."
        settingId="auto-archive"
        title="Auto-archive reviewed work"
      >
        <ToggleSwitch checked label="Auto-archive reviewed work" />
      </SetRow>
      <SetRow
        description="Reviewed work older than this leaves the default history tail."
        settingId="archive-days"
        title="Days before archive"
      >
        <input
          aria-label="Days before archive"
          className="w-[72px] min-h-8 rounded-lg border border-border bg-accent px-2.5 text-[13px] text-foreground opacity-80"
          defaultValue={14}
          max={90}
          min={1}
          readOnly
          type="number"
        />
      </SetRow>
      <SetRow
        description="Where Blackglass opens after launch. Inbox stays the operational default."
        settingId="landing-view"
        title="Default landing view"
      >
        <SelectField
          label="Default landing view"
          options={[
            { label: "Inbox", value: "inbox" },
            { label: "Dashboard", value: "dashboard" },
          ]}
          value="inbox"
        />
      </SetRow>
      <SetRow
        description="Reset every setting on this page to the shipped local defaults."
        settingId="restore-defaults"
        title="Restore defaults"
      >
        <LockedButton
          label="Restore defaults"
          reason="No settings are stored yet. Restore becomes available with the v0.1 settings store."
        />
      </SetRow>
    </>
  );
}

function useSystemResolvedTheme(): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme("system", window.matchMedia(THEME_MEDIA_QUERY).matches),
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
    setResolved(resolveTheme("system", mediaQuery.matches));
    return listenForSystemTheme(mediaQuery, (prefersDark) =>
      setResolved(resolveTheme("system", prefersDark)),
    );
  }, []);

  return resolved;
}

const FAMILY_LABELS: Record<ThemeFamily, string> = {
  smoked: "Smoked lime",
  void: "Void",
  instrument: "Instrument",
  grove: "Grove",
  ember: "Ember",
  iris: "Iris",
};

const themeFamilies = THEME_FAMILIES.map((value) => ({
  value,
  label: FAMILY_LABELS[value],
  darkLabel: `${FAMILY_LABELS[value]} dark`,
  lightLabel: `${FAMILY_LABELS[value]} light`,
}));

function ThemeOrbs() {
  const { family, preference, setAppearance } = useTheme();
  const systemResolved = useSystemResolvedTheme();
  const resolvedScheme = preference === "system" ? systemResolved : preference;

  return (
    <div className="appearance-theme-grid">
      {themeFamilies.map((option) => {
        const selected = family === option.value;
        return (
          <div
            key={option.value}
            className={cn(
              "rounded-xl bg-accent px-3.5 pt-4 pb-3 text-left text-accent-foreground",
              selected && "shadow-[inset_0_0_0_1px_var(--primary)]",
            )}
            data-selected={selected ? "true" : "false"}
            data-theme-family={option.value}
          >
            <div className="mb-4 flex gap-3.5">
              <button
                type="button"
                aria-label={`${option.label} dark`}
                aria-pressed={selected && resolvedScheme === "dark"}
                className="theme-orb shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                data-orb={`${option.value}-dark`}
                data-on={selected && resolvedScheme === "dark" ? "true" : "false"}
                onClick={() => setAppearance({ family: option.value, preference: "dark" })}
              />
              <button
                type="button"
                aria-label={`${option.label} light`}
                aria-pressed={selected && resolvedScheme === "light"}
                className="theme-orb shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                data-orb={`${option.value}-light`}
                data-on={selected && resolvedScheme === "light" ? "true" : "false"}
                onClick={() => setAppearance({ family: option.value, preference: "light" })}
              />
            </div>
            <span className="text-[13px]">{option.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function SchemeRadios() {
  const { preference, setPreference } = useTheme();
  const systemResolved = useSystemResolvedTheme();
  const options: ReadonlyArray<{ description: string; label: string; value: ThemePreference }> = [
    { label: "System", description: "Follow this device's appearance.", value: "system" },
    { label: "Light", description: "Keep the workspace light.", value: "light" },
    { label: "Dark", description: "Keep the workspace dark.", value: "dark" },
  ];

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 text-[13px] font-semibold text-foreground">Scheme</legend>
      <div className="appearance-scheme-options">
        {options.map((option) => {
          const selected = preference === option.value;
          const descriptionId = `theme-${option.value}-description`;
          return (
            <label key={option.value} className="relative block min-h-11 cursor-pointer md:min-h-8">
              <input
                aria-describedby={descriptionId}
                aria-label={option.label}
                className="peer sr-only"
                type="radio"
                name="theme"
                value={option.value}
                checked={selected}
                onChange={() => setPreference(option.value)}
              />
              <span
                className={cn(
                  "flex h-full min-h-11 items-center rounded-[10px] border border-transparent bg-accent px-3 py-2 text-foreground outline-none transition-[border-color,box-shadow,background-color] duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none md:min-h-8",
                  selected && "border-primary",
                )}
                data-selected={selected ? "true" : "false"}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{option.label}</span>
                  <span id={descriptionId} className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                    {option.value === "system" ? `Currently ${systemResolved}` : option.description}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function AppearanceSection() {
  return (
    <>
      <div className="appearance-settings mb-6" id="setting-theme" tabIndex={-1}>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="m-0 text-[13px] font-semibold">Themes</h2>
          <div className="flex gap-2">
            <LockedButton
              label="Create theme"
              reason="Custom themes arrive after the built-in theme families ship."
            />
            <LockedButton
              label="Import theme"
              reason="Custom themes arrive after the built-in theme families ship."
            />
          </div>
        </div>
        <p className="mt-0 mb-3 text-[13px] text-muted-foreground">
          Left bubble is dark. Right bubble is light.
        </p>
        <ThemeOrbs />
      </div>
      <div className="mb-6">
        <SchemeRadios />
      </div>
      <SetRow
        description="How solid transient menus and dialogs appear. The workspace stays black."
        settingId="glass-opacity"
        title="Glass opacity"
      >
        <span className="flex items-center gap-2.5">
          <output className="min-w-[42px] text-right font-mono text-xs">92%</output>
          <input
            aria-label="Glass opacity"
            defaultValue={92}
            disabled
            max={100}
            min={0}
            step={1}
            type="range"
          />
        </span>
      </SetRow>
      <SetRow
        description="Row height and spacing in lists and tables."
        settingId="density"
        title="Density"
      >
        <SelectField
          label="Density"
          options={[
            { label: "Compact", value: "compact" },
            { label: "Regular", value: "regular" },
          ]}
          value="compact"
        />
      </SetRow>
      <SetRow
        description="Disable short color and opacity transitions."
        settingId="reduced-motion"
        title="Reduced motion"
      >
        <ToggleSwitch checked={false} label="Reduced motion" />
      </SetRow>
    </>
  );
}

function EngagementsSection() {
  return (
    <>
      <SetRow
        description="Applied when creating a new engagement from the scope menu."
        settingId="engagement-type"
        title="Default engagement type"
      >
        <SelectField
          label="Default engagement type"
          options={[
            { label: "CTF", value: "ctf" },
            { label: "Lab", value: "lab" },
            { label: "Assessment", value: "assessment" },
          ]}
          value="ctf"
        />
      </SetRow>
      <SetRow
        description="How out-of-scope targets are presented before a run."
        settingId="scope-behavior"
        title="Saved-scope context"
      >
        <SelectField
          label="Saved-scope context"
          options={[
            { label: "Warn, then continue", value: "warn" },
            { label: "Record only", value: "note" },
          ]}
          value="warn"
        />
      </SetRow>
      <SetRow
        description="How many reviewed rows the inbox shows before Show more."
        settingId="history-size"
        title="Reviewed history size"
      >
        <SelectField
          label="Reviewed history size"
          options={[
            { label: "4", value: "4" },
            { label: "10", value: "10" },
            { label: "25", value: "25" },
          ]}
          value="10"
        />
      </SetRow>
    </>
  );
}

function PluginsSettingsSection() {
  return (
    <>
      <SetRow
        description="Local plugin store used by the unprivileged runner."
        settingId="plugin-dir"
        title="Installed directory"
      >
        <PathField label="Installed directory" placeholder="Managed by the control plane" />
      </SetRow>
      <SetRow
        description="Look for newer first-party plugin packages on the local machine."
        settingId="plugin-updates"
        title="Update checks"
      >
        <ToggleSwitch checked label="Update checks" />
      </SetRow>
      <SetRow
        description="Whether disabled plugins stay listed in the inbox action set."
        settingId="disabled-plugins"
        title="Disabled plugin behavior"
      >
        <SelectField
          label="Disabled plugin behavior"
          options={[
            { label: "Keep listed", value: "keep-listed" },
            { label: "Hide", value: "hide" },
          ]}
          value="keep-listed"
        />
      </SetRow>
    </>
  );
}

function RunnerSection() {
  return (
    <>
      <SetRow
        description="Unprivileged host runner on this Linux machine."
        settingId="local-runner"
        title="Local runner"
      >
        <HealthStatus detail="Not surfaced yet" label="Local runner" tone="neutral" />
      </SetRow>
      <SetRow
        description="How many leased runs the runner may execute at once."
        settingId="concurrency"
        title="Concurrency"
      >
        <SelectField
          label="Concurrency"
          options={[
            { label: "1", value: "1" },
            { label: "2", value: "2" },
            { label: "4", value: "4" },
          ]}
          value="2"
        />
      </SetRow>
      <SetRow
        description="Bound captured stdout and stderr per run. Overflow is truncated truthfully."
        settingId="output-limit"
        title="Output limit"
      >
        <SelectField
          label="Output limit"
          options={[
            { label: "2 MiB", value: "2 MiB" },
            { label: "8 MiB", value: "8 MiB" },
            { label: "32 MiB", value: "32 MiB" },
          ]}
          value="8 MiB"
        />
      </SetRow>
      <SetRow
        description="Cancel a run after this wall time unless the operator chose unlimited."
        settingId="timeout"
        title="Timeout"
      >
        <SelectField
          label="Timeout"
          options={[
            { label: "60s", value: "60s" },
            { label: "120s", value: "120s" },
            { label: "Unlimited", value: "unlimited" },
          ]}
          value="120s"
        />
      </SetRow>
    </>
  );
}

function AdvisorSection() {
  const { advisorOpen, toggleAdvisor } = useSettingsView();
  return (
    <>
      <SetRow
        description="Operator stays terse. Mentor explains evidence and expected results."
        settingId="advisor-mode"
        title="Default mode"
      >
        <SelectField
          label="Advisor default mode"
          options={[
            { label: "Operator", value: "operator" },
            { label: "Mentor", value: "mentor" },
          ]}
          value="operator"
        />
      </SetRow>
      <SetRow
        description="OpenAI-compatible base URL. Local and private endpoints are the default path."
        settingId="advisor-endpoint"
        title="Model endpoint"
      >
        <button
          type="button"
          aria-expanded={advisorOpen}
          className="inline-flex min-h-8 items-center rounded-lg px-3 text-[13px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={toggleAdvisor}
        >
          {advisorOpen ? "Hide" : "Details"}
        </button>
      </SetRow>
      {advisorOpen && (
        <div className="mb-2 grid gap-2 pb-2">
          <SetRow
            description="Placeholder endpoint. No request is sent."
            settingId="advisor-endpoint-base-url"
            title="Base URL"
          >
            <PathField label="Model endpoint" placeholder="No model configured yet" />
          </SetRow>
          <SetRow description="Local placeholder. Not a live provider." title="Model id">
            <PathField label="Model id" placeholder="Not configured yet" />
          </SetRow>
        </div>
      )}
      <SetRow
        description="Cap model calls for a single advisor turn."
        settingId="request-budget"
        title="Request budget"
      >
        <SelectField
          label="Request budget"
          options={[
            { label: "4", value: "4" },
            { label: "12", value: "12" },
            { label: "Unlimited", value: "unlimited" },
          ]}
          value="12"
        />
      </SetRow>
      <SetRow
        description="Keep the unparsed model payload visible next to structured output."
        settingId="raw-response"
        title="Raw response visibility"
      >
        <ToggleSwitch checked label="Raw response visibility" />
      </SetRow>
    </>
  );
}

function EvidenceSection() {
  return (
    <>
      <SetRow
        description="Control-plane path for content-addressed evidence."
        settingId="evidence-path"
        title="Local storage path"
      >
        <PathField label="Local storage path" placeholder="/var/lib/blackglass/evidence" />
      </SetRow>
      <SetRow
        description="How long raw evidence remains before an explicit owner deletion."
        settingId="retention"
        title="Retention"
      >
        <SelectField
          label="Retention"
          options={[
            { label: "30 days", value: "30 days" },
            { label: "90 days", value: "90 days" },
            { label: "Keep", value: "keep" },
          ]}
          value="90 days"
        />
      </SetRow>
      <SetRow
        description="Raw artifacts cannot be replaced. Parser updates write new observations."
        settingId="immutable-evidence"
        title="Immutable raw evidence"
      >
        <ToggleSwitch checked label="Immutable raw evidence" />
      </SetRow>
    </>
  );
}

function DiagnosticsSection() {
  const systemStatus = useSystemStatusQuery();
  const tone = systemTone(systemStatus);
  const controlPlaneDetail = !systemStatus.data
    ? systemStatus.isError
      ? "Unavailable"
      : "Checking"
    : systemStatus.data.overall === "ready"
      ? "Ready"
      : "Not ready";
  const storageTone: SystemTone = !systemStatus.data
    ? systemStatus.isError
      ? "fail"
      : "neutral"
    : systemStatus.data.developmentStorage === "ready"
      ? "ok"
      : "warn";
  const storageDetail = !systemStatus.data
    ? systemStatus.isError
      ? "Unavailable"
      : "Checking"
    : systemStatus.data.developmentStorage === "ready"
      ? "WAL ready"
      : "Not ready";
  const lastChecked = systemStatus.dataUpdatedAt
    ? new Date(systemStatus.dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <>
      <SetRow description="Local API and event stream." settingId="health-control-plane" title="Control plane">
        <HealthStatus detail={controlPlaneDetail} label="Control plane" tone={tone} />
      </SetRow>
      <SetRow
        description="Unprivileged host runner identity and heartbeat."
        settingId="health-runner"
        title="Runner"
      >
        <HealthStatus detail="Not reported yet" label="Runner" tone="neutral" />
      </SetRow>
      <SetRow description="WAL database used by the control plane." settingId="health-sqlite" title="SQLite">
        <HealthStatus detail={storageDetail} label="SQLite" tone={storageTone} />
      </SetRow>
      <SetRow
        description="Writable evidence volume and path policy."
        settingId="health-evidence"
        title="Evidence storage"
      >
        <HealthStatus detail={storageDetail} label="Evidence storage" tone={storageTone} />
      </SetRow>
      <SetRow description="Re-read local health state. No network beyond the local API." settingId="run-checks" title="Run checks">
        <button
          type="button"
          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border px-3 text-[13px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void systemStatus.refetch()}
        >
          {lastChecked ? `Checked ${lastChecked}` : "Run checks"}
        </button>
      </SetRow>
    </>
  );
}

const SECTION_BODIES: Record<SettingsSectionId, () => ReactNode> = {
  general: GeneralSection,
  appearance: AppearanceSection,
  engagements: EngagementsSection,
  plugins: PluginsSettingsSection,
  runner: RunnerSection,
  advisor: AdvisorSection,
  evidence: EvidenceSection,
  diagnostics: DiagnosticsSection,
};

export function SettingsPage() {
  const { section, highlightId } = useSettingsView();
  const current = SETTINGS_SECTIONS.find((item) => item.id === section);
  const Body = SECTION_BODIES[section];

  useEffect(() => {
    if (!highlightId) return;
    const node = document.getElementById(`setting-${highlightId}`);
    if (!node) return;
    node.focus({ preventScroll: true });
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "center" });
    }
  }, [highlightId]);

  return (
    <main className="min-h-full bg-background" data-testid="settings-page">
      <div className="mx-auto w-full max-w-[860px] px-4 pt-7 pb-18 sm:px-7">
        <p className="mt-0 mb-7 text-[13px] text-muted-foreground">Settings</p>
        <h1 className="mt-0 mb-2 text-[22px] leading-tight font-semibold tracking-[-0.03em]">
          {current?.label ?? "General"}
        </h1>
        {section === "appearance" ? (
          <p className="mt-0 mb-5.5 text-[13px] text-muted-foreground">
            Choose how Blackglass looks. Use a built-in theme or make your own.
          </p>
        ) : (
          <p className="mt-0 mb-5.5 text-[13px] text-muted-foreground">{LOCKED_NOTE}</p>
        )}
        <div>
          <Body />
        </div>
      </div>
    </main>
  );
}
