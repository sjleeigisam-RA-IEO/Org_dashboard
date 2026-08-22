'use strict';

const assert = require('node:assert/strict');
const ExposureDedupe = require('../../portfolio-analysis/js/exposure-dedupe.js');

function fact(overrides = {}) {
  return {
    role: 'beneficiary',
    partyId: 'INV_398D3B886430',
    partyName: '디에스네트웍스',
    snapshotDate: '2026-06-30',
    fundIds: ['P00028'],
    assetIds: ['AST_001'],
    assetNames: ['DS네트웍스 프로젝트'],
    committedAmount: 2375000000,
    currentAmount: 2375000000,
    remainingAmount: 0,
    exposureId: '106217',
    sourceStandardId: 'INV_398D3B886430',
    remarks: '',
    qualityFlags: [],
    ...overrides
  };
}

function testExplicitExposureIdDuplicate() {
  const result = ExposureDedupe.dedupe([fact(), fact({ sourceIndex: 99 })]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.suppressed.length, 1);
  assert.equal(result.suppressed[0].reason, 'same_exposure_id');
}

function testMarkedAliasDuplicatePrefersCanonicalRow() {
  const duplicate = fact({
    partyName: 'DS네트웍스',
    exposureId: '106394',
    sourceStandardId: '',
    remarks: '기존 exposure_id 106217과 동일 펀드·기준일·자산·금액. alias 차이로 생성된 중복 검토행이며 합산 시 중복 제외 필요.'
  });
  const result = ExposureDedupe.dedupe([duplicate, fact()]);
  assert.deepEqual(result.rows.map(row => row.exposureId), ['106217']);
  assert.equal(result.suppressed.length, 1);
  assert.equal(result.suppressed[0].exposureId, '106394');
  assert.equal(result.suppressed[0].keptExposureId, '106217');
  assert.equal(result.suppressed[0].reason, 'marked_economic_duplicate');
}

function testUnmarkedEqualTranchesRemainSeparate() {
  const result = ExposureDedupe.dedupe([
    fact({ exposureId: '200001', sourceStandardId: '' }),
    fact({ exposureId: '200002', sourceStandardId: '' })
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.suppressed.length, 0);
}

function testMarkedRowsWithDifferentAmountsRemainSeparate() {
  const result = ExposureDedupe.dedupe([
    fact(),
    fact({
      exposureId: '106394',
      sourceStandardId: '',
      committedAmount: 2300000000,
      remarks: '중복 검토행이며 합산 시 중복 제외 필요.'
    })
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.suppressed.length, 0);
}

function testInputOrderDoesNotChangeWinner() {
  const canonical = fact();
  const duplicate = fact({
    partyName: 'DS네트웍스',
    exposureId: '106394',
    sourceStandardId: '',
    remarks: '중복 검토행이며 합산 시 중복 제외 필요.'
  });
  const forward = ExposureDedupe.dedupe([canonical, duplicate]);
  const reverse = ExposureDedupe.dedupe([duplicate, canonical]);
  assert.deepEqual(forward.rows.map(row => row.exposureId), ['106217']);
  assert.deepEqual(reverse.rows.map(row => row.exposureId), ['106217']);
}

function testSameNameWithDifferentCanonicalPartiesRemainsSeparate() {
  const result = ExposureDedupe.dedupe([
    fact({ exposureId: '201', partyId: 'PTY-A', partyName: '동일 명칭' }),
    fact({ exposureId: '202', partyId: 'PTY-B', partyName: '동일 명칭', remarks: '중복 행 합산 제외' })
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.suppressed.length, 0);
}

function testMarkedRowsWithoutAssetIdentityRemainSeparate() {
  const result = ExposureDedupe.dedupe([
    fact({ exposureId: '301', assetIds: [], assetNames: [] }),
    fact({ exposureId: '302', assetIds: [], assetNames: [], remarks: '중복 행 합산 제외' })
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.suppressed.length, 0);
}

function testMarkedDuplicateDoesNotCollapseUnmarkedEqualTranches() {
  const result = ExposureDedupe.dedupe([
    fact({ exposureId: '401' }),
    fact({ exposureId: '402' }),
    fact({ exposureId: '403', remarks: '중복 행 합산 제외' })
  ]);
  assert.deepEqual(result.rows.map(row => row.exposureId), ['401', '402']);
  assert.deepEqual(result.suppressed.map(row => row.exposureId), ['403']);
}

function testUnresolvedDuplicateReviewDoesNotExclude() {
  const result = ExposureDedupe.dedupe([
    fact({ exposureId: '501' }),
    fact({ exposureId: '502', remarks: '중복 여부 검토 필요' })
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.suppressed.length, 0);
  assert.equal(ExposureDedupe.isMarkedDuplicate(result.rows[1]), false);
}

function testNegatedDuplicateDoesNotExclude() {
  const result = ExposureDedupe.dedupe([
    fact({ exposureId: '601' }),
    fact({ exposureId: '602', remarks: '검토 결과 중복 아님 · 제외하지 않음' })
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.suppressed.length, 0);
  assert.equal(ExposureDedupe.isMarkedDuplicate(result.rows[1]), false);
}

const tests = [
  testExplicitExposureIdDuplicate,
  testMarkedAliasDuplicatePrefersCanonicalRow,
  testUnmarkedEqualTranchesRemainSeparate,
  testMarkedRowsWithDifferentAmountsRemainSeparate,
  testInputOrderDoesNotChangeWinner,
  testSameNameWithDifferentCanonicalPartiesRemainsSeparate,
  testMarkedRowsWithoutAssetIdentityRemainSeparate,
  testMarkedDuplicateDoesNotCollapseUnmarkedEqualTranches,
  testUnresolvedDuplicateReviewDoesNotExclude,
  testNegatedDuplicateDoesNotExclude
];

tests.forEach(test => test());
console.log(`Exposure dedupe contract: ${tests.length}/${tests.length} passed`);
