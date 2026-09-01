const test = require('node:test');
const assert = require('node:assert/strict');
const QuarterlyLifecycle = require('../js/quarterly-lifecycle.js');

function build(funds) {
  return QuarterlyLifecycle.buildModel(funds, '2026-07-31', {
    include: (fund) => fund.is_aum_target !== false && fund.parent_child_type !== '자펀드',
    setupDateOf: (fund) => fund.setup_date,
    liquidationDateOf: (fund) => fund.liquidation_date,
    amountOf: (fund) => fund.aum,
    nameOf: (fund) => fund.name
  });
}

test('marks Q1 and Q2 complete, Q3 as July snapshot, and Q4 future', () => {
  const model = build([]);

  assert.equal(model.defaultQuarter, 3);
  assert.deepEqual(model.quarters.map((quarter) => quarter.state), [
    'complete', 'complete', 'current', 'future'
  ]);
  assert.equal(model.quarters[2].statusLabel, '7월말 기준');
  assert.equal(model.quarters[2].end, '2026-07-31');
  assert.equal(model.quarters[3].statusLabel, '미도래');
});

test('uses actual liquidation dates and excludes AUM targets and child funds', () => {
  const model = build([
    { fund_id: 'A', name: '신규 A', setup_date: '2026-04-10', maturity_date: '2026-06-30', aum: 100 },
    { fund_id: 'B', name: '청산 B', setup_date: '2020-01-01', liquidation_date: '2026-05-20', aum: 80 },
    { fund_id: 'C', name: '예정 만기 C', setup_date: '2020-01-01', maturity_date: '2026-05-20', aum: 70 },
    { fund_id: 'D', name: '제외 D', setup_date: '2026-04-01', is_aum_target: false, aum: 60 },
    { fund_id: 'E', name: '자펀드 E', setup_date: '2026-04-01', parent_child_type: '자펀드', aum: 50 }
  ]);
  const q2 = model.quarters[1];

  assert.deepEqual(q2.setup.map((item) => item.id), ['A']);
  assert.deepEqual(q2.liquidation.map((item) => item.id), ['B']);
  assert.equal(q2.setupAmount, 100);
  assert.equal(q2.liquidationAmount, 80);
});

test('deduplicates repeated fund rows by fund id', () => {
  const model = build([
    { fund_id: 'A', name: '신규 A', setup_date: '2026-01-10', aum: 100 },
    { fund_id: 'A', name: '신규 A', setup_date: '2026-01-10', aum: 120 }
  ]);
  const q1 = model.quarters[0];

  assert.equal(q1.setup.length, 1);
  assert.equal(q1.setupAmount, 120);
});
