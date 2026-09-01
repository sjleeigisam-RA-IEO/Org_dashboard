(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AumLookthrough = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function textArray(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      var parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (error) {
      // PostgreSQL text arrays can arrive as {id1,id2}.
    }
    return value.replace(/^\{|\}$/g, '').split(',').map(function (item) {
      return item.trim().replace(/^"|"$/g, '');
    }).filter(Boolean);
  }

  function isFalse(value) {
    return value === false || value === 0 || String(value).toLowerCase() === 'false';
  }

  function relationKey(row, index) {
    return String(row.exposure_uid || [row.fund_id, row.party_id, index].join('|'));
  }

  function applyToFunds(funds, relationships) {
    var sourceFunds = Array.isArray(funds) ? funds : [];
    var activeById = new Map(sourceFunds.filter(function (fund) {
      return fund && fund.fund_id;
    }).map(function (fund) {
      return [String(fund.fund_id), fund];
    }));
    var activeIds = new Set(activeById.keys());
    var seen = new Set();
    var grouped = new Map();
    var eligibleRelationshipRows = 0;

    (relationships || []).forEach(function (row, index) {
      if (!row || row.role_type !== 'beneficiary') return;
      if (row.capital_scope !== 'internal_managed_fund') return;
      if (!isFalse(row.include_in_external_investor_rollup)) return;

      var targetId = String(row.target_fund_id || row.fund_id || '');
      if (!targetId || !activeIds.has(targetId)) return;
      var upstreamIds = textArray(row.included_upstream_fund_ids || row.investor_managed_fund_ids)
        .filter(function (fundId) { return activeIds.has(fundId); });
      if (!upstreamIds.length) return;

      var key = relationKey(row, index);
      if (seen.has(key)) return;
      seen.add(key);
      eligibleRelationshipRows += 1;

      var current = grouped.get(targetId) || {
        targetFundId: targetId,
        benchmarkCandidate: 0,
        investedCandidate: 0,
        relationshipRows: 0,
        upstreamFundIds: new Set()
      };
      current.benchmarkCandidate += number(row.benchmark_overlap_candidate ?? row.committed_amt);
      current.investedCandidate += number(row.invested_overlap_candidate ?? row.invested_amt);
      current.relationshipRows += 1;
      upstreamIds.forEach(function (fundId) { current.upstreamFundIds.add(fundId); });
      grouped.set(targetId, current);
    });

    var adjustmentByTarget = new Map();
    var benchmarkOverlap = 0;
    var investedOverlap = 0;
    grouped.forEach(function (group, targetId) {
      var target = activeById.get(targetId) || {};
      var benchmarkCap = Math.max(0, number(target.equity_won));
      var investedCap = Math.max(0, number(target.invested_equity_won));
      var benchmarkAmount = Math.min(group.benchmarkCandidate, benchmarkCap);
      var investedAmount = Math.min(group.investedCandidate, investedCap);
      benchmarkOverlap += benchmarkAmount;
      investedOverlap += investedAmount;
      adjustmentByTarget.set(targetId, {
        targetFundId: targetId,
        relationshipRows: group.relationshipRows,
        upstreamFundIds: Array.from(group.upstreamFundIds).sort(),
        benchmarkOverlap: benchmarkAmount,
        investedOverlap: investedAmount
      });
    });

    var adjustedFunds = sourceFunds.map(function (fund) {
      var adjustment = adjustmentByTarget.get(String(fund?.fund_id || ''));
      if (!adjustment) return fund;
      var copy = Object.assign({}, fund, {
        benchmark_aum: Math.max(0, number(fund.benchmark_aum) - adjustment.benchmarkOverlap),
        equity_won: Math.max(0, number(fund.equity_won) - adjustment.benchmarkOverlap),
        invested_aum: Math.max(0, number(fund.invested_aum) - adjustment.investedOverlap),
        invested_equity_won: Math.max(0, number(fund.invested_equity_won) - adjustment.investedOverlap),
        aum_lookthrough_benchmark_overlap: adjustment.benchmarkOverlap,
        aum_lookthrough_invested_overlap: adjustment.investedOverlap,
        aum_lookthrough_upstream_fund_ids: adjustment.upstreamFundIds,
        aum_lookthrough_adjusted: true
      });
      return copy;
    });

    return {
      funds: adjustedFunds,
      adjustments: Array.from(adjustmentByTarget.values()),
      benchmarkOverlap: benchmarkOverlap,
      investedOverlap: investedOverlap,
      eligibleRelationshipRows: eligibleRelationshipRows
    };
  }

  return {
    applyToFunds: applyToFunds,
    textArray: textArray
  };
});
