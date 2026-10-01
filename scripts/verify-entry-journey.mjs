import assert from "node:assert/strict";
import {
  curvePath,
  journeyCurves,
} from "../src/components/public-entry/entryJourneyGeometry.ts";

for (const width of [320, 390, 768, 1280]) {
  const stops = [
    [width * 0.72, 220],
    [width * 0.64, 480],
    [width * 0.32, 1100],
    [width * 0.75, 2000],
    [width * 0.5, 2900],
  ];
  let previousEnd;
  for (let leg = 0; leg < stops.length - 1; leg++) {
    const curves = journeyCurves(stops[leg], stops[leg + 1], width, leg);
    const [a, b] = curves;
    assert.deepEqual(a[0], stops[leg]);
    assert.deepEqual(b[3], stops[leg + 1]);
    if (previousEnd)
      assert.deepEqual(a[0], previousEnd, "arrival must be the next departure");
    assert.deepEqual(a[3], b[0], "curve join must not have a gap");
    for (const axis of [0, 1]) {
      assert.ok(
        Math.abs(a[3][axis] - a[2][axis] - (b[1][axis] - b[0][axis])) < 1e-8,
        "join tangent must stay continuous",
      );
    }
    for (const curve of curves) {
      curve.flat().forEach((value) => assert.ok(Number.isFinite(value)));
      curve.forEach(([x]) =>
        assert.ok(
          x >= 0 && x <= width,
          "curve must stay within the viewport width",
        ),
      );
    }
    const path = curvePath(curves);
    assert.equal((path.match(/C/g) || []).length, 2);
    assert.ok(!/[LHV]/.test(path), "journey must only use curves");
    previousEnd = b[3];
  }
  const downward = journeyCurves(stops[0], stops[1], width, 0);
  const leftward = journeyCurves(stops[0], stops[1], width, 1);
  const rightward = journeyCurves(stops[0], stops[1], width, 3);
  assert.ok(leftward[0][3][0] < downward[0][3][0]);
  assert.ok(rightward[0][3][0] > downward[0][3][0]);
}
console.log(
  "PASS entry journey: shared endpoints, continuous tangents, four directions, viewport bounds (320/390/768/1280).",
);
