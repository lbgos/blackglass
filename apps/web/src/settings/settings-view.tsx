import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_SETTINGS_SECTION,
  type SettingsIndexEntry,
  type SettingsSectionId,
} from "./model.js";

interface SettingsViewContextValue {
  section: SettingsSectionId;
  setSection: (section: SettingsSectionId) => void;
  query: string;
  setQuery: (query: string) => void;
  activeHit: number;
  setActiveHit: (index: number) => void;
  highlightId: string | null;
  activateHit: (entry: SettingsIndexEntry) => void;
  advisorOpen: boolean;
  toggleAdvisor: () => void;
}

const SettingsViewContext = createContext<SettingsViewContextValue | null>(null);

export function SettingsViewProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [section, setSection] = useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION);
  const [query, setQueryState] = useState("");
  const [activeHit, setActiveHit] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const highlightTimer = useRef(0);
  // Resetting here (instead of on sidebar mount) avoids racing user clicks while
  // remaining on /settings; only a fresh false-to-true route transition resets.
  const wasActive = useRef(active);
  if (active && !wasActive.current) {
    setSection(DEFAULT_SETTINGS_SECTION);
    setQueryState("");
    setActiveHit(0);
    setHighlightId(null);
    setAdvisorOpen(false);
  }
  wasActive.current = active;

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setActiveHit(0);
  }, []);

  const setSectionAndClearHighlight = useCallback((next: SettingsSectionId) => {
    setSection(next);
    setHighlightId(null);
  }, []);

  const activateHit = useCallback(
    (entry: SettingsIndexEntry) => {
      window.clearTimeout(highlightTimer.current);
      setQueryState("");
      setActiveHit(0);
      setSection(entry.section);
      // Only the Model endpoint row lives behind the Details disclosure; set the
      // exact state so a non-endpoint hit also closes stale details, and do it
      // in the same update so the highlight effect can reach the target.
      setAdvisorOpen(entry.id === "advisor-endpoint");
      setHighlightId(entry.id);
      highlightTimer.current = window.setTimeout(() => setHighlightId(null), 1600);
    },
    [],
  );

  const toggleAdvisor = useCallback(() => setAdvisorOpen((open) => !open), []);

  const value = useMemo<SettingsViewContextValue>(
    () => ({
      section,
      setSection: setSectionAndClearHighlight,
      query,
      setQuery,
      activeHit,
      setActiveHit,
      highlightId,
      activateHit,
      advisorOpen,
      toggleAdvisor,
    }),
    [
      section,
      setSectionAndClearHighlight,
      query,
      setQuery,
      activeHit,
      highlightId,
      activateHit,
      advisorOpen,
      toggleAdvisor,
    ],
  );

  return <SettingsViewContext value={value}>{children}</SettingsViewContext>;
}

export function useSettingsView(): SettingsViewContextValue {
  const context = useContext(SettingsViewContext);
  if (!context) throw new Error("useSettingsView must be used inside SettingsViewProvider.");
  return context;
}
