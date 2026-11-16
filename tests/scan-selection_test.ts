import { assertAlmostEquals, assertEquals } from "@std/assert";
import { automaticSelectionCoverage } from "web/scan-selection.ts";

Deno.test("automatic selection requires 5% at center, 15% halfway to a quadrant, and 25% in a corner quadrant", () => {
  assertAlmostEquals(automaticSelectionCoverage({ x: .5, y: .5 }), .05);
  for (
    const center of [
      { x: .375, y: .375 },
      { x: .625, y: .375 },
      { x: .375, y: .625 },
      { x: .625, y: .625 },
    ]
  ) {
    assertAlmostEquals(automaticSelectionCoverage(center), .15);
  }
  for (
    const center of [
      { x: .25, y: .25 },
      { x: .75, y: .25 },
      { x: .25, y: .75 },
      { x: .75, y: .75 },
    ]
  ) {
    assertAlmostEquals(automaticSelectionCoverage(center), .25);
  }
});

Deno.test("selection uses the hypotenuse so equal radial distances have equal requirements", () => {
  const diagonalOffset = .25 / Math.SQRT2;
  const horizontal = automaticSelectionCoverage({ x: .75, y: .5 });
  assertAlmostEquals(horizontal, .05 + .20 / Math.SQRT2);
  assertAlmostEquals(
    automaticSelectionCoverage({
      x: .5 + diagonalOffset,
      y: .5 + diagonalOffset,
    }),
    horizontal,
  );
});

Deno.test("coverage requirement caps at 25% beyond a corner quadrant and rejects invalid centers", () => {
  for (const center of [{ x: 0, y: .5 }, { x: 1, y: 1 }, { x: -1, y: 2 }]) {
    assertAlmostEquals(automaticSelectionCoverage(center), .25);
  }
  assertEquals(automaticSelectionCoverage({ x: NaN, y: .5 }), Infinity);
  assertEquals(automaticSelectionCoverage({ x: .5, y: Infinity }), Infinity);
});
