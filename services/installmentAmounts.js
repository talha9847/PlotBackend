"use strict";

/**
 * Split a whole-rupee balance into the closest possible whole-rupee
 * installments. The final `remainder` rows receive one extra rupee so the
 * returned amounts always sum exactly to the balance.
 */
function splitInstallmentAmounts(balance, count) {
  const total = Number(balance);
  const installmentCount = Number(count);

  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError("Balance must be a whole-rupee amount.");
  }

  if (!Number.isSafeInteger(installmentCount) || installmentCount <= 0) {
    throw new RangeError("Installment count must be a positive integer.");
  }

  if (total < installmentCount) {
    throw new RangeError(
      "Balance must be at least the number of installments.",
    );
  }

  const base = Math.floor(total / installmentCount);
  const remainder = total - base * installmentCount;
  const amounts = new Array(installmentCount).fill(base);

  for (
    let index = installmentCount - remainder;
    index < installmentCount;
    index += 1
  ) {
    amounts[index] += 1;
  }

  return amounts;
}

module.exports = {
  splitInstallmentAmounts,
};
