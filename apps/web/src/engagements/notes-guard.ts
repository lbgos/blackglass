import { useBlocker } from "@tanstack/react-router";
import { useCallback } from "react";

// Blocks in-app navigation while a notes draft is dirty and enables the
// native beforeunload prompt for reload and tab close. Holds no note
// contents and performs no persistence; Stay keeps local draft state,
// Leave allows the blocked navigation to proceed.
export function useNotesDraftGuard(active: boolean) {
  const shouldBlockFn = useCallback(() => active, [active]);
  return useBlocker({
    shouldBlockFn,
    enableBeforeUnload: active,
    disabled: !active,
    withResolver: true as const,
  });
}
