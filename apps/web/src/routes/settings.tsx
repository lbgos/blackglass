import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { SETTINGS_SECTIONS, type SettingsSectionId } from "../settings/model.js";
import { SettingsPage } from "../settings/page.js";
import { useSettingsView } from "../settings/settings-view.js";

const SECTION_IDS: ReadonlySet<string> = new Set(
  SETTINGS_SECTIONS.map((section) => section.id),
);

function SettingsRoutePage() {
  const search = Route.useSearch();
  const { setSection } = useSettingsView();
  const section = search.section;
  // Deep link (e.g. the console Advisor card) lands on one section. The
  // provider resets to the default when entering /settings; this effect runs
  // after that reset so an explicit ?section= wins, while plain entry keeps
  // the default.
  useEffect(() => {
    if (section !== undefined && SECTION_IDS.has(section)) {
      setSection(section as SettingsSectionId);
    }
  }, [section, setSection]);
  return <SettingsPage />;
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: string } =>
    typeof search.section === "string" ? { section: search.section } : {},
  component: SettingsRoutePage,
});
