import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "../settings/page.js";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});
