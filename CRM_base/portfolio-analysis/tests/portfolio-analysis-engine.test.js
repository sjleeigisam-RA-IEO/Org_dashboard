const assert = require('node:assert/strict');
const Engine = require('../js/portfolio-analysis-engine.js');

const funds = [
  {
    fund_id: 'F1', fund_name: '국내 개발 오피스', status: '운용', aum_status: '운용',
    benchmark_aum: 100,
    notion_vehicle_class: 'Fund', notion_holding_type_class: '일반펀드', fund_class: '부동산형',
    location: '국내', notion_base_asset_class: '오피스', is_development: 'Y',
    notion_business_stage_class: '개발', notion_investment_strategy_class: 'Core'
  },
  {
    fund_id: 'F2', fund_name: '해외 물류 재간접', status: '운용', aum_status: '운용',
    benchmark_aum: 200,
    notion_vehicle_class: 'Fund', notion_holding_type_class: '일반펀드', fund_class: '부동산형',
    location: '해외', notion_base_asset_class: '물류센터', is_development: 'N',
    notion_business_stage_class: '운영/실물', notion_investment_strategy_class: '재간접'
  },
  {
    fund_id: 'P1', fund_name: '국내 오피스 PFV', status: '운용', aum_status: '운용',
    benchmark_aum: 300,
    notion_vehicle_class: 'PFV', notion_holding_type_class: '일반펀드', location: '국내',
    notion_base_asset_class: '오피스', is_development: 'Y', notion_business_stage_class: '개발'
  },
  {
    fund_id: 'F3', fund_name: '특별자산', status: '운용', aum_status: '운용',
    benchmark_aum: 50,
    notion_vehicle_class: 'Fund', notion_holding_type_class: '일반펀드', fund_class: '특별자산형',
    location: '국내', notion_base_asset_class: '특별자산', is_development: 'N'
  },
  {
    fund_id: 'F4', fund_name: '혼합 지역 포트폴리오', status: '운용', aum_status: '운용',
    benchmark_aum: 400,
    notion_vehicle_class: 'Fund', notion_holding_type_class: '자펀드', fund_class: '부동산형',
    location: '글로벌', notion_base_asset_class: '오피스, 물류센터', is_development: 'N'
  },
  {
    fund_id: 'F5', fund_name: '청산 오피스', status: '청산', aum_status: '청산',
    benchmark_aum: 500,
    notion_vehicle_class: 'Fund', notion_holding_type_class: '일반펀드', fund_class: '부동산형',
    location: '국내', notion_base_asset_class: '오피스', is_development: 'N'
  }
];

const assets = [
  { fund_id: 'F1', asset_id: 'A1', asset_name: '서울 오피스', asset_type: '오피스', address: '서울특별시 중구 세종대로 1', metadata: { pnu: '1114010100100010000' } },
  { fund_id: 'F2', asset_id: 'I1', asset_name: 'Global Logistics Fund', asset_type: '물류센터', asset_kind: 'fund_interest', directness: 'look_through', location_category: '해외' },
  { fund_id: 'P1', asset_id: 'A2', asset_name: '서울 개발 오피스', asset_type: '오피스', address: '서울특별시 영등포구 국제금융로 1', business_stage: '개발' },
  { fund_id: 'F4', asset_id: 'A3', asset_name: '국내 오피스', asset_type: '오피스', address: '서울특별시 강남구 테헤란로 1', location_category: '국내' },
  { fund_id: 'F4', asset_id: 'A4', asset_name: '해외 물류', asset_type: '물류센터', address: '100 Main Street London UK', location_category: '해외' },
  { fund_id: 'F5', asset_id: 'A1', asset_name: '서울 오피스', asset_type: '오피스', address: '서울특별시 중구 세종대로 1', metadata: { pnu: '1114010100100010000' } }
];

const dataset = Engine.createDataset(funds, assets);

const activeFunds = Engine.query(dataset, {
  filters: { operational_status: ['운용'], vehicle_type: ['Fund'] },
  countBasis: 'fund_code'
});
assert.equal(activeFunds.metrics.fundCount, 4);
assert.equal(activeFunds.metrics.propertyCount, 3);
assert.equal(activeFunds.metrics.nonPropertyCount, 1);

const activeVehicles = Engine.query(dataset, {
  filters: { operational_status: ['운용'] },
  countBasis: 'fund_code'
});
assert.equal(activeVehicles.metrics.fundCount, 5);
assert.equal(activeVehicles.metrics.fundVehicleCount, 4);
assert.equal(activeVehicles.metrics.pfvVehicleCount, 1);
assert.equal(activeVehicles.metrics.otherVehicleCount, 0);
assert.equal(
  activeVehicles.metrics.fundVehicleCount
    + activeVehicles.metrics.pfvVehicleCount
    + activeVehicles.metrics.otherVehicleCount,
  activeVehicles.metrics.fundCount
);

const representative = Engine.query(dataset, {
  filters: { operational_status: ['운용'], vehicle_type: ['Fund'] },
  countBasis: 'representative'
});
assert.equal(representative.metrics.fundCount, 3);

const domesticDevelopmentOffice = Engine.query(dataset, {
  filters: {
    operational_status: ['운용'], vehicle_type: ['Fund'], domestic_overseas: ['국내'],
    base_asset_class: ['오피스'], business_stage: ['개발']
  }
});
assert.deepEqual(domesticDevelopmentOffice.funds.map((fund) => fund.fund_id), ['F1']);

const sameExposureGuard = Engine.query(dataset, {
  filters: {
    operational_status: ['운용'], vehicle_type: ['Fund'], domestic_overseas: ['해외'],
    base_asset_class: ['오피스']
  }
});
assert.equal(sameExposureGuard.funds.some((fund) => fund.fund_id === 'F4'), false);

const indirect = Engine.query(dataset, {
  filters: { operational_status: ['운용'], investment_mode: ['재간접'] }
});
assert.deepEqual(indirect.funds.map((fund) => fund.fund_id), ['F2']);

const assetQuestion = Engine.parseQuestion('현재 운용 펀드에 연결된 부동산 자산은 몇 개?');
assert.equal(assetQuestion.metric, 'asset_count');
assert.deepEqual(assetQuestion.filters.vehicle_type, ['Fund']);
const assetAnswer = Engine.answerQuestion(dataset, assetQuestion);
assert.equal(assetAnswer.value, 3);

const developmentQuestion = Engine.parseQuestion('PFV를 포함한 개발펀드 비율은?');
assert.equal(developmentQuestion.metric, 'ratio');
assert.deepEqual(developmentQuestion.denominatorFilters.vehicle_type, ['Fund', 'PFV']);
const developmentAnswer = Engine.answerQuestion(dataset, developmentQuestion);
assert.equal(developmentAnswer.numerator, 2);
assert.equal(developmentAnswer.denominator, 5);
assert.equal(developmentAnswer.value, 40);

const complexQuestion = Engine.parseQuestion('국내 개발 오피스 펀드는 몇 개?');
const complexAnswer = Engine.answerQuestion(dataset, complexQuestion);
assert.deepEqual(complexAnswer.matchingFunds.map((fund) => fund.fund_id), ['F1']);

const distributionQuestion = Engine.parseQuestion('부동산과 비부동산 펀드 비율은?');
assert.equal(distributionQuestion.metric, 'distribution');
assert.equal(distributionQuestion.dimension, 'property_domain');

assert.equal(Engine.parseQuestion('이지스 200호'), null);
assert.equal(Engine.parseQuestion('강남 오피스 자산'), null);

const compositionResult = Engine.query(dataset, {
  filters: { operational_status: ['운용'], vehicle_type: ['Fund'] },
  countBasis: 'fund_code'
});
const composition = Engine.buildAumComposition(compositionResult, { amountField: 'benchmark_aum' });
assert.equal(composition.sourceTotal, 750);
assert.equal(composition.allocatedTotal, 750);
assert.ok(Math.abs(composition.allocationGap) < 1e-9);
assert.equal(composition.assetRows.length, 5);
assert.equal(composition.assetRows.at(-1).cumulativeRatio, 100);

const locationAmounts = Object.fromEntries(composition.distributions.domestic_overseas.map(row => [row.label, row.amount]));
assert.equal(locationAmounts['국내'], 350);
assert.equal(locationAmounts['해외'], 400);

const classAmounts = Object.fromEntries(composition.distributions.base_asset_class.map(row => [row.label, row.amount]));
assert.equal(classAmounts['오피스'], 300);
assert.equal(classAmounts['물류센터'], 400);
assert.equal(classAmounts['특별자산'], 50);

const mixedDomestic = composition.assetRows.find(row => row.name === '국내 오피스');
const mixedOverseas = composition.assetRows.find(row => row.name === '해외 물류');
assert.equal(mixedDomestic.amount, 200);
assert.equal(mixedOverseas.amount, 200);

const aumTargetResult = Engine.query(dataset, {
  filters: { operational_status: ['운용'], vehicle_type: ['Fund'] },
  countBasis: 'aum_target'
});
const aumTargetComposition = Engine.buildAumComposition(aumTargetResult, { amountField: 'benchmark_aum' });
assert.equal(aumTargetComposition.sourceTotal, 350);
assert.equal(aumTargetComposition.includedFundCount, 3);

console.log('portfolio-analysis-engine tests passed');
