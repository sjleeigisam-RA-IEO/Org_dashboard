const test = require('node:test');
const assert = require('node:assert/strict');
const ExposureDedupe = require('../js/exposure-dedupe.js');

test('prefers an authoritative direct beneficiary row over a delegated estimate for the same party and fund', () => {
  const direct = [{
    role: 'beneficiary',
    partyId: 'PARTY-1',
    fundIds: ['FUND-1'],
    exposureId: 'DIRECT-1',
    committedAmount: 250,
    includeInExternalInvestorRollup: true,
    capitalScope: 'external_party'
  }];
  const delegated = [{
    role: 'beneficiary',
    partyId: 'PARTY-1',
    partyName: '기관 1',
    fundIds: ['FUND-1'],
    exposureId: 'DELEGATED-1',
    committedAmount: 217.5,
    paidInAvailable: false
  }];

  const result = ExposureDedupe.suppressDelegatedDirectOverlaps(direct, delegated);

  assert.equal(result.rows.length, 0);
  assert.equal(result.suppressed.length, 1);
  assert.equal(result.suppressed[0].reason, 'direct_authority_same_party_fund');
  assert.equal(result.suppressed[0].keptExposureId, 'DIRECT-1');
  assert.equal(result.suppressed[0].directCommittedAmount, 250);
});

test('keeps delegated estimates when the direct party or fund differs', () => {
  const direct = [{
    role: 'beneficiary',
    partyId: 'PARTY-1',
    fundIds: ['FUND-1'],
    exposureId: 'DIRECT-1',
    includeInExternalInvestorRollup: true,
    capitalScope: 'external_party'
  }];
  const delegated = [
    { role: 'beneficiary', partyId: 'PARTY-2', fundIds: ['FUND-1'], exposureId: 'DELEGATED-1' },
    { role: 'beneficiary', partyId: 'PARTY-1', fundIds: ['FUND-2'], exposureId: 'DELEGATED-2' }
  ];

  const result = ExposureDedupe.suppressDelegatedDirectOverlaps(direct, delegated);

  assert.deepEqual(result.rows.map((row) => row.exposureId), ['DELEGATED-1', 'DELEGATED-2']);
  assert.equal(result.suppressed.length, 0);
});

test('does not let an excluded internal direct row suppress a delegated estimate', () => {
  const direct = [{
    role: 'beneficiary',
    partyId: 'PARTY-1',
    fundIds: ['FUND-1'],
    exposureId: 'SHELL-1',
    includeInExternalInvestorRollup: false,
    isInternalFundLookthroughShell: true,
    capitalScope: 'internal_fund_lookthrough_shell'
  }];
  const delegated = [{
    role: 'beneficiary',
    partyId: 'PARTY-1',
    fundIds: ['FUND-1'],
    exposureId: 'DELEGATED-1'
  }];

  const result = ExposureDedupe.suppressDelegatedDirectOverlaps(direct, delegated);

  assert.equal(result.rows.length, 1);
  assert.equal(result.suppressed.length, 0);
});
