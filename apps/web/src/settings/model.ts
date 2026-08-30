export type SettingsSectionId =
  | "general"
  | "appearance"
  | "engagements"
  | "plugins"
  | "runner"
  | "advisor"
  | "evidence"
  | "diagnostics";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "engagements", label: "Engagements" },
  { id: "plugins", label: "Plugins" },
  { id: "runner", label: "Runner" },
  { id: "advisor", label: "Advisor" },
  { id: "evidence", label: "Evidence" },
  { id: "diagnostics", label: "Diagnostics" },
];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "appearance";

export interface SettingsIndexEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  description: string;
}

export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
  { id: "auto-continue", section: "general", title: "Auto-continue engagement warnings", description: "Skip the warning dialog for this engagement and record each continue automatically." },
  { id: "timestamp-format", section: "general", title: "Timestamp format", description: "System default follows the host clock. Used in tables, console, and history." },
  { id: "auto-archive", section: "general", title: "Auto-archive reviewed work", description: "Move reviewed actions out of the history tail after a set number of days." },
  { id: "archive-days", section: "general", title: "Days before archive", description: "Reviewed work older than this leaves the default history tail." },
  { id: "landing-view", section: "general", title: "Default landing view", description: "Where Blackglass opens after launch. Inbox stays the operational default." },
  { id: "restore-defaults", section: "general", title: "Restore defaults", description: "Reset every setting on this page to the shipped local defaults." },
  { id: "theme", section: "appearance", title: "Theme", description: "Smoked glass on true black. Swatches are previews only." },
  { id: "glass-opacity", section: "appearance", title: "Glass opacity", description: "How solid transient menus and dialogs appear. The workspace stays black." },
  { id: "density", section: "appearance", title: "Density", description: "Row height and spacing in settings and plugin rows." },
  { id: "reduced-motion", section: "appearance", title: "Reduced motion", description: "Disable short color and opacity transitions." },
  { id: "engagement-type", section: "engagements", title: "Default engagement type", description: "Applied when creating a new engagement from the scope menu." },
  { id: "scope-behavior", section: "engagements", title: "Saved-scope context", description: "How out-of-scope targets are presented before a run." },
  { id: "history-size", section: "engagements", title: "Reviewed history size", description: "How many reviewed rows the inbox shows before Show more." },
  { id: "plugin-dir", section: "plugins", title: "Installed directory", description: "Local plugin store used by the unprivileged runner." },
  { id: "plugin-updates", section: "plugins", title: "Update checks", description: "Look for newer first-party plugin packages on the local machine." },
  { id: "disabled-plugins", section: "plugins", title: "Disabled plugin behavior", description: "Whether disabled plugins stay listed in the inbox action set." },
  { id: "local-runner", section: "runner", title: "Local runner", description: "Unprivileged host runner on this Linux machine." },
  { id: "concurrency", section: "runner", title: "Concurrency", description: "How many leased runs the runner may execute at once." },
  { id: "output-limit", section: "runner", title: "Output limit", description: "Bound captured stdout and stderr per run. Overflow is truncated truthfully." },
  { id: "timeout", section: "runner", title: "Timeout", description: "Cancel a run after this wall time unless the operator chose unlimited." },
  { id: "advisor-mode", section: "advisor", title: "Default mode", description: "Operator stays terse. Mentor explains evidence and expected results." },
  { id: "advisor-endpoint", section: "advisor", title: "Model endpoint", description: "OpenAI-compatible base URL. Local and private endpoints are the default path." },
  { id: "request-budget", section: "advisor", title: "Request budget", description: "Cap model calls for a single advisor turn." },
  { id: "raw-response", section: "advisor", title: "Raw response visibility", description: "Keep the unparsed model payload visible next to structured output." },
  { id: "evidence-path", section: "evidence", title: "Local storage path", description: "Control-plane path for content-addressed evidence." },
  { id: "retention", section: "evidence", title: "Retention", description: "How long raw evidence remains before an explicit owner deletion." },
  { id: "immutable-evidence", section: "evidence", title: "Immutable raw evidence", description: "Raw artifacts cannot be replaced. Parser updates write new observations." },
  { id: "health-control-plane", section: "diagnostics", title: "Control plane", description: "Local API and event stream." },
  { id: "health-runner", section: "diagnostics", title: "Runner", description: "Unprivileged host runner identity and heartbeat." },
  { id: "health-sqlite", section: "diagnostics", title: "SQLite", description: "WAL database used by the control plane." },
  { id: "health-evidence", section: "diagnostics", title: "Evidence storage", description: "Writable evidence volume and path policy." },
  { id: "run-checks", section: "diagnostics", title: "Run checks", description: "Re-read local health state. No network beyond the local API." },
];

export function searchSettings(query: string): SettingsIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_INDEX.filter((entry) =>
    `${entry.title} ${entry.description} ${entry.section}`.toLowerCase().includes(q),
  );
}
