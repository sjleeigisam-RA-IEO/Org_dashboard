const test = require('node:test');
const assert = require('node:assert/strict');
const Lookthrough = require('../js/aum-lookthrough.js');

test('subtracts one legal exposure once even when it has multiple upstream fund ids', () => {
  const funds = [
    { fund_id: 'UP1', benchmark_aum: 200, equity_won: 200, invested_aum: 180, invested_equity_won: 180 },
    { fund_id: 'UP2', benchmark_aum: 100, equity_won: 100, invested_aum: 90, invested_equity_won: 90 },
    { fund_id: 'TARGET', benchmark_aum: 500, equity_won: 150, loan_won: 350, invested_aum: 450, invested_equity_won: 120 }
  ];
  const relationships = [{
    exposure_uid: 'E1', role_type: 'beneficiary', capital_scope: 'internal_managed_fund',
    include_in_external_investor_rollup: false, fund_id: 'TARGET',
    investor_managed_fund_ids: ['UP1', 'UP2'], committed_amt: 80, invested_amt: 70
  }];

  const result = Lookthrough.applyToFunds(funds, relationships);
  const target = result.funds.find((fund) => fund.fund_id === 'TARGET');
  assert.equal(result.benchmarkOverlap, 80);
  assert.equal(result.investedOverlap, 70);
  assert.equal(result.eligibleRelationshipRows, 1);
  assert.equal(target.benchmark_aum, 420);
  assert.equal(target.equity_won, 70);
});

test('caps overlap at target equity and ignores relationships without both active endpoints', () => {
  const funds = [
    { fund_id: 'UP', benchmark_aum: 200, equity_won: 200, invested_aum: 200, invested_equity_won: 200 },
    { fund_id: 'TARGET', benchmark_aum: 400, equity_won: 50, loan_won: 350, invested_aum: 390, invested_equity_won: 40 }
  ];
  const relationships = [
    { exposure_uid: 'E1', role_type: 'beneficiary', capital_scope: 'internal_managed_fund', include_in_external_investor_rollup: false, fund_id: 'TARGET', investor_managed_fund_ids: ['UP'], committed_amt: 90, invested_amt: 80 },
    { exposure_uid: 'E2', role_type: 'beneficiary', capital_scope: 'internal_managed_fund', include_in_external_investor_rollup: false, fund_id: 'TARGET', investor_managed_fund_ids: ['NOT_ACTIVE'], committed_amt: 20, invested_amt: 20 }
  ];

  const result = Lookthrough.applyToFunds(funds, relationships);
  const target = result.funds.find((fund) => fund.fund_id === 'TARGET');
  assert.equal(result.benchmarkOverlap, 50);
  assert.equal(result.investedOverlap, 40);
  assert.equal(target.benchmark_aum, 350);
  assert.equal(target.equity_won, 0);
  assert.equal(target.invested_aum, 350);
});
