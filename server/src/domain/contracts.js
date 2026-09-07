// How the running contracts are being used.
//
// Three ways a contract quietly costs money, none of which show up as an error anywhere:
//   - never used at all, so an agreed rate expires unused
//   - expiring soon with value left on it
//   - nearly used up, so the next order falls outside it at spot price
//
// Nobody gets an alert for any of these. That is exactly why they belong on a dashboard.

export function assessContract(contract) {
  const percentUsed = Math.round((contract.used / contract.target) * 100);
  const remaining = contract.target - contract.used;

  let flag;
  if (contract.used === 0) flag = 'never used';
  else if (contract.daysLeft <= 30) flag = 'expiring soon';
  else if (percentUsed >= 90) flag = 'nearly used up';
  else flag = 'fine';

  return {
    ...contract,
    percentUsed,
    remaining,
    flag,
    band:
      flag === 'never used' ? 'risk' : flag === 'fine' ? 'good' : 'watch',
    needsAttention: flag !== 'fine'
  };
}

// Soonest to expire first: that is the one where doing nothing costs you the option.
export function assessAllContracts(contracts) {
  return contracts.map(assessContract).sort((a, b) => a.daysLeft - b.daysLeft);
}

export function contractsNeedingAttention(assessed) {
  return assessed.filter((c) => c.needsAttention);
}
