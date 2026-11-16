import type { Point } from "web/scanner.ts";

/** Required coverage rises from 5% at scan center to 25% at a corner quadrant's center. */
export function automaticSelectionCoverage(center: Point): number {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return Infinity;
  const distance = Math.hypot(center.x - .5, center.y - .5);
  const cornerQuadrantDistance = Math.hypot(.25, .25);
  return .05 + .20 * distance / cornerQuadrantDistance;
}
