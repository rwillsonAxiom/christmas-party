import type { Point } from "web/scanner.ts";

/** Required coverage rises from 1% at scan center to 25% at a corner quadrant's center, without a cap. */
export function automaticSelectionCoverage(center: Point): number {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return Infinity;
  const distance = Math.hypot(center.x - 0.5, center.y - 0.5);
  const cornerQuadrantDistance = Math.hypot(0.25, 0.25);
  return 0.01 + 0.24 * distance / cornerQuadrantDistance;
}
