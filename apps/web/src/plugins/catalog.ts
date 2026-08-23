export type PluginTier = "T0" | "T1" | "T2" | "T3";

export interface PluginCatalogEntry {
  description: string;
  enabled: boolean;
  executable: string;
  id: string;
  installed: boolean;
  name: string;
  origin: string;
  tier: PluginTier;
}

// Only actions whose contracts exist in packages/contracts are listed. Entries are
// never marked enabled while decision gate D5 (plugin protocol and installation)
// remains unresolved, so no control on the Plugins page can claim a live adapter.
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
  {
    description: "Port and service discovery on a host or CIDR.",
    enabled: false,
    executable: "nmap",
    id: "nmap",
    installed: true,
    name: "Nmap",
    origin: "first-party contract",
    tier: "T1",
  },
];

export function catalogForTab(
  entries: readonly PluginCatalogEntry[],
  tab: "installed" | "available",
): PluginCatalogEntry[] {
  return entries.filter((entry) => (tab === "installed" ? entry.installed : !entry.installed));
}
