/**
 * STONE-6 starred focus helper. Starred targets/leads give a focused view
 * that narrows the list without hiding active jobs and without changing
 * saved data. Pure set operations over ids; storage lives in the
 * workspace-state store.
 */

export function toggleStarred(starredIds: readonly string[], id: string): readonly string[] {
  if (starredIds.includes(id)) return starredIds.filter((entry) => entry !== id);
  return [...starredIds, id];
}

export interface StarrableItem {
  readonly id: string;
  readonly hasActiveJob: boolean;
}

/**
 * Focused view: starred items first, then active unstarred jobs (never
 * hidden). Idle unstarred items drop out of the focused list only.
 */
export function focusedStarredView<T extends StarrableItem>(
  items: readonly T[],
  starredIds: readonly string[],
  focused: boolean,
): readonly T[] {
  if (focused === false) return items;
  const starred = new Set(starredIds);
  const primary = items.filter((item) => starred.has(item.id));
  const active = items.filter((item) => starred.has(item.id) === false && item.hasActiveJob);
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...primary, ...active]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}
