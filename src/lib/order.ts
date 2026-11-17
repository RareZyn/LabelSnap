// Sparse float ordering for Entries: a move or insert writes one document instead of renumbering the list.

export const ORDER_STEP = 1024;
const MIN_GAP = 1e-6;

/** Order value for a new item placed between two neighbours (either may be missing). */
export function orderBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = typeof before === 'number' && Number.isFinite(before);
  const hasAfter = typeof after === 'number' && Number.isFinite(after);
  if (hasBefore && hasAfter) return (before + after) / 2;
  if (hasBefore) return before + ORDER_STEP;
  if (hasAfter) return after - ORDER_STEP;
  return ORDER_STEP;
}

/** True when two neighbours are too close to split again, and the list should be rebalanced. */
export function needsRebalance(before: number | null | undefined, after: number | null | undefined): boolean {
  if (typeof before !== 'number' || typeof after !== 'number') return false;
  return Math.abs(after - before) < MIN_GAP;
}

/** Evenly spaced order values for a list in its current sequence. */
export function rebalance<T extends { id: string }>(items: T[]): Array<{ id: string; order: number }> {
  return items.map((item, i) => ({ id: item.id, order: (i + 1) * ORDER_STEP }));
}

/**
 * The new order value for an item moved from index `from` to index `to` in a list sorted by order.
 * Returns null when the move is a no-op.
 */
export function orderForMove<T extends { order: number }>(items: T[], from: number, to: number): number | null {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return null;
  const rest = items.filter((_, i) => i !== from);
  const before = rest[to - 1]?.order;
  const after = rest[to]?.order;
  return orderBetween(before, after);
}

/** 1-based figure numbers, derived from the sorted order. */
export function figureNumbers<T extends { id: string; order: number }>(items: T[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  return new Map(sorted.map((item, i) => [item.id, i + 1]));
}
