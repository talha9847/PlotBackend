"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  splitInstallmentAmounts,
} = require("../services/installmentAmounts");

test("splitInstallmentAmounts keeps whole-rupee installments as close as possible", () => {
  assert.deepEqual(splitInstallmentAmounts(7000, 3), [2333, 2333, 2334]);
  assert.deepEqual(splitInstallmentAmounts(100000, 3), [33333, 33333, 33334]);
  assert.deepEqual(splitInstallmentAmounts(100000, 7), [
    14285, 14285, 14286, 14286, 14286, 14286, 14286,
  ]);
  assert.deepEqual(splitInstallmentAmounts(11, 10), [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 2,
  ]);
  assert.deepEqual(splitInstallmentAmounts(5, 5), [1, 1, 1, 1, 1]);
});

test("splitInstallmentAmounts accepts PostgreSQL numeric strings and sums exactly", () => {
  const amounts = splitInstallmentAmounts("44000.00", 13);

  assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), 44000);
  assert.equal(amounts.every(Number.isInteger), true);
  assert.equal(Math.max(...amounts) - Math.min(...amounts), 1);
  assert.deepEqual(amounts, [
    3384, 3384, 3384, 3384, 3384, 3385, 3385, 3385, 3385, 3385, 3385, 3385,
    3385,
  ]);
});

test("splitInstallmentAmounts rejects invalid balances and counts", () => {
  assert.throws(
    () => splitInstallmentAmounts(7000.5, 3),
    /whole-rupee amount/,
  );
  assert.throws(() => splitInstallmentAmounts(7000, 0), /positive integer/);
  assert.throws(() => splitInstallmentAmounts(7000, 2.5), /positive integer/);
  assert.throws(
    () => splitInstallmentAmounts(2, 3),
    /at least the number of installments/,
  );
});
