import assert from "node:assert/strict";
import test from "node:test";

test("fixture a", () => {
  const row01 = 1 + 2;
  const row02 = row01 + 3;
  const row03 = row02 + 4;
  const row04 = row03 + 5;
  const row05 = row04 + 6;
  const row06 = row05 + 7;
  const row07 = row06 + 8;
  const row08 = row07 + 9;
  const row09 = row08 + 10;
  const row10 = row09 + 11;
  const row11 = row10 + 12;
  assert.equal(row11, 78);
});
