import type { Point } from "web/scanner.ts";

/** Required coverage rises from 5% at scan center to 25% at a corner quadrant's center. */
export function automaticSelectionCoverage(center: Point): number {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return Infinity;
  const distance = Math.hypot(center.x - 0.5, center.y - 0.5);
  const cornerQuadrantDistance = Math.hypot(0.25, 0.25);
  return 0.25 * distance / cornerQuadrantDistance;
}
